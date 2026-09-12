-- Migration 057 — partial-update RPC for tenant_providers.
--
-- The existing tenant_providers_save_keys overwrites every field — making the
-- dashboard's "Update keys" CTA force the user to re-paste publishable + secret
-- + webhook for both test and live every time they just want to change one
-- value (e.g. swap a stale whsec_ for a fresh one printed by `stripe listen`).
--
-- This RPC treats NULL params as "don't change". The dashboard sends only the
-- fields the user actually touched; everything else stays put.

CREATE OR REPLACE FUNCTION public.tenant_providers_update_keys(
  p_tenant_id            UUID,
  p_provider             TEXT,
  p_test_key_id          TEXT DEFAULT NULL,
  p_test_secret          TEXT DEFAULT NULL,
  p_test_webhook_secret  TEXT DEFAULT NULL,
  p_live_key_id          TEXT DEFAULT NULL,
  p_live_secret          TEXT DEFAULT NULL,
  p_live_webhook_secret  TEXT DEFAULT NULL,
  p_supported_locales    TEXT[] DEFAULT NULL
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

  -- Refuse if there's no existing row — use tenant_providers_save_keys for the
  -- initial save (it sets sensible defaults like supported_locales).
  IF NOT EXISTS (
    SELECT 1 FROM tenant_providers WHERE tenant_id = p_tenant_id AND provider = p_provider
  ) THEN
    RAISE EXCEPTION 'no existing % provider row — call tenant_providers_save_keys first', p_provider;
  END IF;

  UPDATE tenant_providers SET
    test_key_id              = COALESCE(p_test_key_id, test_key_id),
    test_secret_key_enc      = CASE WHEN p_test_secret IS NULL THEN test_secret_key_enc
                                    ELSE encrypt_provider_key(p_test_secret) END,
    test_webhook_secret_enc  = CASE WHEN p_test_webhook_secret IS NULL THEN test_webhook_secret_enc
                                    ELSE encrypt_provider_key(p_test_webhook_secret) END,
    live_key_id              = COALESCE(p_live_key_id, live_key_id),
    live_secret_key_enc      = CASE WHEN p_live_secret IS NULL THEN live_secret_key_enc
                                    ELSE encrypt_provider_key(p_live_secret) END,
    live_webhook_secret_enc  = CASE WHEN p_live_webhook_secret IS NULL THEN live_webhook_secret_enc
                                    ELSE encrypt_provider_key(p_live_webhook_secret) END,
    supported_locales        = COALESCE(p_supported_locales, supported_locales),
    updated_at               = NOW()
  WHERE tenant_id = p_tenant_id AND provider = p_provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_update_keys(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
) TO authenticated;
