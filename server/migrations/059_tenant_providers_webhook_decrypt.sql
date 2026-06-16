-- Migration 059 — service-role decrypt RPC for the stripe-webhook Edge Function.
--
-- The existing tenant_providers_decrypt_key requires auth.uid() to match a
-- tenant_admin row (correct for dashboard usage), but the stripe-webhook
-- function runs unauthenticated — Stripe's signed POST carries no Supabase
-- session. The Edge Function calls Supabase using SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS but still hits SECURITY DEFINER functions through their
-- own auth checks. So we need a SECURITY DEFINER RPC that:
--   - whitelists service_role only (no public.authenticated grant)
--   - returns BOTH the secret key AND the webhook signing secret
--     in a single round-trip for the requested mode
--
-- This is the per-tenant equivalent of STRIPE_TEST_WEBHOOK_SECRET — without
-- it, multi-tenant deploys can't verify Stripe signatures because each tenant
-- has their own whsec_ (from their own Dashboard registration or Stripe CLI).

CREATE OR REPLACE FUNCTION public.tenant_providers_decrypt_for_webhook(
  p_tenant_id UUID,
  p_provider  TEXT,
  p_mode      TEXT
)
RETURNS TABLE (
  secret_key      TEXT,
  webhook_secret  TEXT,
  key_id          TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  -- Defense-in-depth — refuse anything that isn't authenticated as service_role
  -- (the Edge Function's auth context). Dashboard callers never reach this RPC
  -- because we don't grant authenticated; they use tenant_providers_decrypt_key
  -- which has the tenant_admins check instead.
  IF current_setting('role', true) NOT IN ('service_role', 'postgres') THEN
    RAISE EXCEPTION 'tenant_providers_decrypt_for_webhook: forbidden (role=%, expected service_role)', current_setting('role', true);
  END IF;

  IF p_mode = 'live' THEN
    RETURN QUERY
    SELECT
      decrypt_provider_key(tp.live_secret_key_enc)::TEXT,
      decrypt_provider_key(tp.live_webhook_secret_enc)::TEXT,
      tp.live_key_id
    FROM tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id AND tp.provider = p_provider;
  ELSE
    RETURN QUERY
    SELECT
      decrypt_provider_key(tp.test_secret_key_enc)::TEXT,
      decrypt_provider_key(tp.test_webhook_secret_enc)::TEXT,
      tp.test_key_id
    FROM tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id AND tp.provider = p_provider;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_providers_decrypt_for_webhook(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_providers_decrypt_for_webhook(uuid, text, text) TO service_role;
