-- 112_psp_account_tier.sql
--
-- Put Stripe / Razorpay / Cashfree on the same account tier the stores got in 104.
--
-- 103–109 moved STORE credentials to `provider_accounts`, so one Play console can serve many apps.
-- PSP credentials never moved: a Stripe secret key still lived on each app's `tenant_providers`
-- row, so an operator running six apps off one Stripe account pasted the same key six times and
-- rotated it six times — and a missed one keeps charging on a revoked key until someone notices.
-- That is the same problem the account tier already solved, left half-applied.
--
-- ── Why a credential DOCUMENT rather than more columns ───────────────────────────────────────
-- A store connection is one secret (an SA JSON, a .p8). A PSP connection is six fields —
-- {test,live} × {key_id, secret, webhook_secret}. Rather than widen `provider_accounts` with six
-- PSP-shaped columns that mean nothing to a store row, the whole set is stored as a JSON document
-- in the existing `credential_enc`, exactly as google_play already stores its service-account JSON
-- there. One column, one meaning: "the opaque credential this connection holds".
--
-- The non-secret key ids are ALSO mirrored into `config` so the picker can name a connection
-- ("sk_live_…abcd") without decrypting anything — the same rule 106 set for `client_email`.
--
-- ── What stays on the app ────────────────────────────────────────────────────────────────────
-- `payment_links` and `supported_locales` do NOT move. A payment link is a per-app checkout URL;
-- the account owns the credential, the app owns where its customers land. Moving them would make
-- two apps sharing a Stripe account share a checkout page, which is not what sharing a key means.
--
-- ── One resolver, two readers ────────────────────────────────────────────────────────────────
-- `tenant_providers_decrypt_key` (dashboard, tenant-admin guarded) and
-- `tenant_providers_decrypt_for_webhook` (Edge Functions, service_role guarded) both read these
-- credentials, and they MUST agree: if the dashboard charges through the account key while webhook
-- verification still checks the app-local secret, every signature fails and the failure looks like
-- a provider outage. Both now call the same `tenant_psp_credential_resolve`, so the resolution rule
-- exists once. Their different authorisation checks are unchanged — only the lookup is shared.

-- ── 1. The shared resolver ───────────────────────────────────────────────────────────────────
-- Precedence mirrors 104 exactly: pinned account → account default → app-local columns. App-local
-- last, so attaching an app to a connection actually takes effect; an account with no credential
-- never shadows a working app-local key.
CREATE OR REPLACE FUNCTION public.tenant_psp_credential_resolve(
  p_tenant_id UUID,
  p_provider  TEXT,
  p_mode      TEXT
)
RETURNS TABLE (secret_key TEXT, webhook_secret TEXT, key_id TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tp    RECORD;
  v_acct  RECORD;
  v_owner UUID;
  v_doc   JSONB;
  v_pfx   TEXT := CASE WHEN p_mode = 'live' THEN 'live' ELSE 'test' END;
BEGIN
  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  SELECT u.id INTO v_owner
  FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
  WHERE t.id = p_tenant_id LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM tenant_admins
    WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
  END IF;

  IF v_tp.provider_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSE
    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  IF v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL THEN
    BEGIN
      v_doc := decrypt_provider_key(v_acct.credential_enc)::JSONB;
    EXCEPTION WHEN OTHERS THEN
      -- A credential that is not a PSP document (a store SA JSON on a mis-typed row, say) must not
      -- abort the read with a cast error. Fall through to the app-local key, which is the state
      -- the app was in before the account existed.
      v_doc := NULL;
    END;
  END IF;

  IF v_doc IS NOT NULL AND NULLIF(v_doc->>(v_pfx || '_secret'), '') IS NOT NULL THEN
    RETURN QUERY SELECT
      v_doc->>(v_pfx || '_secret'),
      NULLIF(v_doc->>(v_pfx || '_webhook_secret'), ''),
      NULLIF(v_doc->>(v_pfx || '_key_id'), '');
    RETURN;
  END IF;

  IF p_mode = 'live' THEN
    RETURN QUERY SELECT decrypt_provider_key(v_tp.live_secret_key_enc)::TEXT,
                        decrypt_provider_key(v_tp.live_webhook_secret_enc)::TEXT,
                        v_tp.live_key_id;
  ELSE
    RETURN QUERY SELECT decrypt_provider_key(v_tp.test_secret_key_enc)::TEXT,
                        decrypt_provider_key(v_tp.test_webhook_secret_enc)::TEXT,
                        v_tp.test_key_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.tenant_psp_credential_resolve(UUID, TEXT, TEXT) IS
  'Internal: the PSP credential this app bills through (pinned account → account default → app-local). Shared by the dashboard and webhook readers so they cannot disagree.';

REVOKE ALL ON FUNCTION public.tenant_psp_credential_resolve(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_psp_credential_resolve(UUID, TEXT, TEXT) TO service_role;

-- ── 2. Dashboard reader — authorisation unchanged, lookup shared ─────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_providers_decrypt_key(
  p_tenant_id UUID,
  p_provider  TEXT,
  p_mode      TEXT
)
RETURNS TABLE (secret_key TEXT, key_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT r.secret_key, r.key_id
  FROM tenant_psp_credential_resolve(p_tenant_id, p_provider, p_mode) r;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_providers_decrypt_key(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_providers_decrypt_key(UUID, TEXT, TEXT) TO authenticated, service_role;

-- ── 3. Webhook reader — service_role check unchanged, lookup shared ──────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_providers_decrypt_for_webhook(
  p_tenant_id UUID,
  p_provider  TEXT,
  p_mode      TEXT
)
RETURNS TABLE (secret_key TEXT, webhook_secret TEXT, key_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Defense-in-depth — refuse anything that isn't authenticated as service_role (the Edge
  -- Function's auth context). Dashboard callers use tenant_providers_decrypt_key instead.
  IF current_setting('role', true) NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'tenant_providers_decrypt_for_webhook: forbidden (role=%, expected service_role)',
      current_setting('role', true);
  END IF;

  RETURN QUERY
  SELECT r.secret_key, r.webhook_secret, r.key_id
  FROM tenant_psp_credential_resolve(p_tenant_id, p_provider, p_mode) r;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_providers_decrypt_for_webhook(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_providers_decrypt_for_webhook(UUID, TEXT, TEXT) TO service_role;

-- ── 4. Save a PSP connection onto the account, and attach this app ───────────────────────────
-- The PSP twin of tenant_store_account_save (109), with the same three protections: an explicit
-- create, a guard on replacing a credential other apps depend on, and an ownership check.
CREATE OR REPLACE FUNCTION public.tenant_psp_account_save(
  p_tenant_id           UUID,
  p_provider            TEXT,
  p_label               TEXT,
  p_test_key_id         TEXT,
  p_test_secret         TEXT,
  p_test_webhook_secret TEXT,
  p_live_key_id         TEXT,
  p_live_secret         TEXT,
  p_live_webhook_secret TEXT,
  p_account_id          UUID    DEFAULT NULL,
  p_create_new          BOOLEAN DEFAULT false,
  p_confirm_shared      BOOLEAN DEFAULT false
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner    UUID;
  v_id       UUID;
  v_tp       RECORD;
  v_acct     RECORD;
  v_is_first BOOLEAN;
  v_in_use   INT;
  v_existing JSONB := '{}'::jsonb;
  v_doc      JSONB;
  v_cfg      JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  v_owner := auth.uid();

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  IF p_create_new THEN
    IF COALESCE(p_test_secret,'') = '' AND COALESCE(p_live_secret,'') = '' THEN
      RAISE EXCEPTION 'credential_required_for_new_connection';
    END IF;
    v_id := NULL;
  ELSE
    v_id := p_account_id;
    IF v_id IS NOT NULL THEN
      SELECT * INTO v_acct FROM provider_accounts WHERE id = v_id;
      IF v_acct.id IS NULL THEN RAISE EXCEPTION 'unknown_connection'; END IF;
      IF v_acct.owner_user_id <> v_owner
         AND NOT EXISTS (
           SELECT 1 FROM tenant_admins ta
           WHERE ta.user_id = v_acct.owner_user_id AND ta.tenant_id = p_tenant_id
         ) THEN RAISE EXCEPTION 'forbidden_connection'; END IF;
    ELSE
      v_id := v_tp.provider_account_id;
      IF v_id IS NULL THEN
        SELECT a.id INTO v_id FROM provider_accounts a
        WHERE a.provider = p_provider AND a.is_default AND a.owner_user_id = v_owner
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_id IS NOT NULL
     AND (COALESCE(p_test_secret,'') <> '' OR COALESCE(p_live_secret,'') <> '')
     AND NOT p_confirm_shared THEN
    SELECT count(*) INTO v_in_use FROM tenant_providers WHERE provider_account_id = v_id;
    IF v_in_use > 1 THEN RAISE EXCEPTION 'shared_credential_in_use:%', v_in_use; END IF;
  END IF;

  -- Merge over the existing document so a test-only edit does not wipe the live keys — the field
  -- set is partial by nature, and a blank field means "unchanged", never "clear it".
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_id;
    IF v_acct.credential_enc IS NOT NULL THEN
      BEGIN v_existing := decrypt_provider_key(v_acct.credential_enc)::JSONB;
      EXCEPTION WHEN OTHERS THEN v_existing := '{}'::jsonb; END;
    END IF;
  END IF;

  v_doc := v_existing;
  IF COALESCE(p_test_key_id,'')         <> '' THEN v_doc := v_doc || jsonb_build_object('test_key_id', p_test_key_id); END IF;
  IF COALESCE(p_test_secret,'')         <> '' THEN v_doc := v_doc || jsonb_build_object('test_secret', p_test_secret); END IF;
  IF COALESCE(p_test_webhook_secret,'') <> '' THEN v_doc := v_doc || jsonb_build_object('test_webhook_secret', p_test_webhook_secret); END IF;
  IF COALESCE(p_live_key_id,'')         <> '' THEN v_doc := v_doc || jsonb_build_object('live_key_id', p_live_key_id); END IF;
  IF COALESCE(p_live_secret,'')         <> '' THEN v_doc := v_doc || jsonb_build_object('live_secret', p_live_secret); END IF;
  IF COALESCE(p_live_webhook_secret,'') <> '' THEN v_doc := v_doc || jsonb_build_object('live_webhook_secret', p_live_webhook_secret); END IF;

  -- Non-secret ids only: what the picker needs to tell two connections apart without decrypting.
  v_cfg := jsonb_strip_nulls(jsonb_build_object(
    'test_key_id', NULLIF(v_doc->>'test_key_id',''),
    'live_key_id', NULLIF(v_doc->>'live_key_id','')
  ));

  SELECT NOT EXISTS (
    SELECT 1 FROM provider_accounts WHERE owner_user_id = v_owner AND provider = p_provider
  ) INTO v_is_first;

  IF v_id IS NULL THEN
    INSERT INTO provider_accounts (owner_user_id, provider, label, credential_enc, config, is_default)
    VALUES (v_owner, p_provider,
            COALESCE(NULLIF(btrim(p_label),''), p_provider || ' connection'),
            encrypt_provider_key(v_doc::TEXT), v_cfg, v_is_first)
    RETURNING id INTO v_id;
  ELSE
    UPDATE provider_accounts SET
      label          = COALESCE(NULLIF(btrim(p_label),''), label),
      credential_enc = encrypt_provider_key(v_doc::TEXT),
      config         = config || v_cfg,
      updated_at     = now()
    WHERE id = v_id;
  END IF;

  INSERT INTO tenant_providers (tenant_id, provider, provider_account_id, is_active)
  VALUES (p_tenant_id, p_provider, v_id, true)
  ON CONFLICT (tenant_id, provider) DO UPDATE SET provider_account_id = EXCLUDED.provider_account_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.tenant_psp_account_save(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN) IS
  'Upserts the provider ACCOUNT holding a PSP credential document and attaches this app. Blank fields mean unchanged. payment_links/supported_locales stay app-scoped.';

REVOKE ALL ON FUNCTION public.tenant_psp_account_save(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_psp_account_save(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, BOOLEAN, BOOLEAN) TO authenticated, service_role;
