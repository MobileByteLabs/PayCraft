-- Migration 049: tenant_providers enhancements — key_id columns, supported_locales,
--   tenant_products.razorpay_plan_id_by_currency, save_keys + decrypt RPCs.
-- Pairs with Phase 5 of paycraft-dashboard-provider-integration epic.

-- 1. Add non-secret key_id columns + supported_locales to tenant_providers.
ALTER TABLE public.tenant_providers
  ADD COLUMN IF NOT EXISTS test_key_id        TEXT,
  ADD COLUMN IF NOT EXISTS live_key_id        TEXT,
  ADD COLUMN IF NOT EXISTS supported_locales  TEXT[];

-- 2. Add Razorpay plan ID tracking to tenant_products.
ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS razorpay_plan_id_by_currency JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenant_products.razorpay_plan_id_by_currency IS
  'Map of currency → Razorpay plan_id created via razorpay-product-sync.ts.';

-- 3. RPC: tenant_providers_save_keys — validates membership, encrypts + upserts provider row.
CREATE OR REPLACE FUNCTION tenant_providers_save_keys(
  p_tenant_id             UUID,
  p_provider              TEXT,
  p_test_key_id           TEXT,
  p_test_secret           TEXT,
  p_test_webhook_secret   TEXT,
  p_live_key_id           TEXT,
  p_live_secret           TEXT,
  p_live_webhook_secret   TEXT,
  p_supported_locales     TEXT[] DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  INSERT INTO tenant_providers (
    tenant_id, provider,
    test_key_id, test_secret_key_enc, test_webhook_secret_enc,
    live_key_id, live_secret_key_enc, live_webhook_secret_enc,
    supported_locales,
    test_payment_links, live_payment_links
  ) VALUES (
    p_tenant_id, p_provider,
    p_test_key_id,
    encrypt_provider_key(p_test_secret),
    encrypt_provider_key(p_test_webhook_secret),
    p_live_key_id,
    encrypt_provider_key(p_live_secret),
    encrypt_provider_key(p_live_webhook_secret),
    COALESCE(p_supported_locales, ARRAY['IN']),
    '{}'::jsonb, '{}'::jsonb
  )
  ON CONFLICT (tenant_id, provider) DO UPDATE SET
    test_key_id              = EXCLUDED.test_key_id,
    test_secret_key_enc      = EXCLUDED.test_secret_key_enc,
    test_webhook_secret_enc  = EXCLUDED.test_webhook_secret_enc,
    live_key_id              = EXCLUDED.live_key_id,
    live_secret_key_enc      = EXCLUDED.live_secret_key_enc,
    live_webhook_secret_enc  = EXCLUDED.live_webhook_secret_enc,
    supported_locales        = EXCLUDED.supported_locales,
    updated_at               = now();
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_providers_save_keys(uuid, text, text, text, text, text, text, text, text[]) TO authenticated;

-- 4. RPC: tenant_providers_decrypt_key — returns the decrypted secret key for a given provider + mode.
--    Only callable by an admin of the tenant; used by razorpay-client.ts server-side.
CREATE OR REPLACE FUNCTION tenant_providers_decrypt_key(
  p_tenant_id UUID,
  p_provider  TEXT,
  p_mode      TEXT   -- 'test' | 'live'
)
RETURNS TABLE (secret_key TEXT, key_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_mode = 'live' THEN
    RETURN QUERY
    SELECT
      decrypt_provider_key(tp.live_secret_key_enc)::TEXT,
      tp.live_key_id
    FROM tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id AND tp.provider = p_provider;
  ELSE
    RETURN QUERY
    SELECT
      decrypt_provider_key(tp.test_secret_key_enc)::TEXT,
      tp.test_key_id
    FROM tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id AND tp.provider = p_provider;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_providers_decrypt_key(uuid, text, text) TO authenticated;

-- 5. RPC: tenant_providers_status — lightweight check (key_id presence = connected).
CREATE OR REPLACE FUNCTION tenant_providers_status(
  p_tenant_id UUID,
  p_provider  TEXT
)
RETURNS TABLE (test_key_id TEXT, live_key_id TEXT, connected BOOLEAN)
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
  SELECT tp.test_key_id, tp.live_key_id, (tp.test_key_id IS NOT NULL)
  FROM tenant_providers tp
  WHERE tp.tenant_id = p_tenant_id AND tp.provider = p_provider;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_providers_status(uuid, text) TO authenticated;

-- 6. RPC: tenant_products_set_razorpay_ids
CREATE OR REPLACE FUNCTION tenant_products_set_razorpay_ids(
  p_id                       UUID,
  p_razorpay_plan_id_by_currency JSONB
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

  UPDATE tenant_products
    SET razorpay_plan_id_by_currency = p_razorpay_plan_id_by_currency
    WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_products_set_razorpay_ids(uuid, jsonb) TO authenticated;
