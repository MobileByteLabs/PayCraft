-- 074 — Per-tenant native-store credentials + product-id write-back RPC.
--
-- Phase 2 of PayCraft dashboard store-sync. Phase 1 (073) added the
-- tenant_products.play_product_id / app_store_product_id columns so the SDK's
-- native lanes can resolve store product ids. Phase 2 lets the dashboard
-- AUTO-CREATE / SYNC those store products by giving each tenant a place to
-- store their OWN store credentials, exactly mirroring the encrypted
-- tenant_providers pattern the web-PSP lanes (stripe/razorpay/cashfree) use:
--
--   • provider='google_play'  → encrypted service-account JSON blob
--                               + non-secret { package_name }
--   • provider='app_store'    → encrypted App Store Connect .p8 key
--                               + non-secret { key_id, issuer_id, bundle_id }
--
-- Why NEW columns instead of reusing test_secret_key_enc:
--   The existing per-provider secret columns are modelled as a
--   test/live/webhook TRIPLE (see 049 tenant_providers_save_keys). A store
--   credential is a SINGLE blob (a whole SA JSON document, or a whole .p8
--   PEM) plus a bag of non-secret ids — a different shape. Rather than
--   overload the triple, we add a dedicated single-blob column
--   (store_credential_enc BYTEA — pgcrypto BYTEA is unbounded, so a multi-KB
--   SA JSON / .p8 fits) and a store_config JSONB for the non-secret ids.
--   tenant_providers.provider is free-text (022), so the new
--   'google_play'/'app_store' rows coexist with the PSP rows with no enum
--   change and the same UNIQUE(tenant_id, provider) one-row-per-provider
--   guarantee.
--
-- Encryption reuses the SAME pgcrypto helpers as 022
-- (encrypt_provider_key / decrypt_provider_key over app.encryption_key).
-- Plaintext is NEVER stored; the decrypt RPC is admin-checked and only the
-- dashboard route layer / edge functions call it. RLS stays service_role-only
-- on the table; the RPCs are SECURITY DEFINER with an explicit tenant_admins
-- membership check, identical to tenant_providers_save_keys / _decrypt_key.
--
-- Idempotent. Safe to re-run after partial application or db reset.

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_providers
  ADD COLUMN IF NOT EXISTS store_credential_enc BYTEA,
  ADD COLUMN IF NOT EXISTS store_config         JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenant_providers.store_credential_enc IS
  'Encrypted native-store credential blob (google_play SA JSON / app_store .p8 PEM), pgcrypto over app.encryption_key. NULL until first save.';
COMMENT ON COLUMN public.tenant_providers.store_config IS
  'Non-secret native-store config: google_play={package_name}, app_store={key_id,issuer_id,bundle_id}.';

-- ── 2. Save RPC — encrypt-and-upsert a store credential (partial-update safe)
--    Mirrors tenant_providers_save_keys (049): admin membership check,
--    SECURITY DEFINER, ON CONFLICT upsert. An empty/NULL p_credential means
--    "keep the existing encrypted blob" so an operator can update just the
--    non-secret config (e.g. fix a package name) without re-pasting the SA
--    JSON. p_config is merged over the existing config (jsonb ||).
CREATE OR REPLACE FUNCTION public.tenant_providers_save_store_keys(
  p_tenant_id  UUID,
  p_provider   TEXT,   -- 'google_play' | 'app_store'
  p_credential TEXT,   -- SA JSON / .p8 PEM; '' or NULL keeps existing blob
  p_config     JSONB   -- non-secret ids; merged over existing store_config
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_provider NOT IN ('google_play', 'app_store') THEN
    RAISE EXCEPTION 'tenant_providers_save_store_keys supports google_play|app_store only, got %', p_provider;
  END IF;

  INSERT INTO tenant_providers (
    tenant_id, provider, store_credential_enc, store_config,
    test_payment_links, live_payment_links
  ) VALUES (
    p_tenant_id, p_provider,
    CASE WHEN COALESCE(p_credential, '') = '' THEN NULL
         ELSE encrypt_provider_key(p_credential) END,
    COALESCE(p_config, '{}'::jsonb),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (tenant_id, provider) DO UPDATE SET
    store_credential_enc = CASE
      WHEN COALESCE(p_credential, '') = '' THEN tenant_providers.store_credential_enc
      ELSE encrypt_provider_key(p_credential) END,
    store_config = COALESCE(tenant_providers.store_config, '{}'::jsonb)
                     || COALESCE(p_config, '{}'::jsonb),
    updated_at   = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_save_store_keys(uuid, text, text, jsonb) TO authenticated;

-- ── 3. Decrypt RPC — full credential for the route/edge layer only ─────────
--    Mirrors tenant_providers_decrypt_key (049). Returns the decrypted blob +
--    non-secret config. Admin-checked. NEVER exposed to the SDK.
CREATE OR REPLACE FUNCTION public.tenant_providers_decrypt_store_key(
  p_tenant_id UUID,
  p_provider  TEXT
)
RETURNS TABLE (credential TEXT, config JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    CASE WHEN tp.store_credential_enc IS NULL THEN NULL
         ELSE decrypt_provider_key(tp.store_credential_enc)::TEXT END,
    COALESCE(tp.store_config, '{}'::jsonb)
  FROM tenant_providers tp
  WHERE tp.tenant_id = p_tenant_id AND tp.provider = p_provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_decrypt_store_key(uuid, text) TO authenticated;

-- ── 4. Status RPC — non-secret connectivity probe (never returns the blob) ──
--    Mirrors tenant_providers_status (049). connected = a credential blob is
--    present. Returns ONLY the non-secret config for the UI to render.
CREATE OR REPLACE FUNCTION public.tenant_providers_store_status(
  p_tenant_id UUID,
  p_provider  TEXT
)
RETURNS TABLE (connected BOOLEAN, config JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT (tp.store_credential_enc IS NOT NULL), COALESCE(tp.store_config, '{}'::jsonb)
  FROM tenant_providers tp
  WHERE tp.tenant_id = p_tenant_id AND tp.provider = p_provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_store_status(uuid, text) TO authenticated;

-- ── 5. Write-back RPC — set native store product ids on a product ──────────
--    Mirrors tenant_products_set_stripe_ids (045) / _set_razorpay_ids (049).
--    Each id is INDEPENDENTLY updatable: a Play-only sync passes
--    p_app_store_product_id = NULL and only touches play_product_id, and vice
--    versa (COALESCE keeps the untouched column). Admin-checked via the
--    owning tenant.
CREATE OR REPLACE FUNCTION public.tenant_products_set_store_ids(
  p_id                   UUID,
  p_play_product_id      TEXT,
  p_app_store_product_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'product not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE tenant_products SET
    play_product_id      = COALESCE(p_play_product_id, play_product_id),
    app_store_product_id = COALESCE(p_app_store_product_id, app_store_product_id),
    updated_at           = now()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_products_set_store_ids(uuid, text, text) TO authenticated;
