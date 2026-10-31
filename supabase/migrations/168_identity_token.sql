-- 168 — verified identity WITHOUT Supabase users (PLAN-paycraft-verified-identity D2/D3/D4).
--
-- The identity-token edge function verifies a provider ID token itself and hands back a verified
-- email — no auth.users row, no MAU. This migration carries its two pieces of server state:
--
--   1. tenants.auth_apple_client_secret_enc — the app's Apple client secret (D4). The Apple web
--      flow MUST use the app's own Services ID (Apple's sheet names the primary app), so its secret
--      is per tenant and stored ENCRYPTED via encrypt_provider_key; only service_role can decrypt.
--   2. identity_sessions — the one-time polling handoff for the web flow (D2): /start inserts a
--      pending row, /callback marks it verified|failed, /result reads it once and deletes it.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS auth_apple_client_secret_enc bytea;

CREATE TABLE IF NOT EXISTS public.identity_sessions (
  id         text PRIMARY KEY,
  tenant_id  uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('google', 'apple')),
  email      text,
  status     text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'failed')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS on, no policies: service_role (the edge function) only. A session id is a bearer handle to a
-- verified email until /result consumes it, so anon must never be able to read the table.
ALTER TABLE public.identity_sessions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS identity_sessions_created_at_idx ON public.identity_sessions (created_at);

-- ── Apple client secret: read (decrypt) ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_apple_client_secret(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_enc bytea;
BEGIN
  SELECT auth_apple_client_secret_enc INTO v_enc FROM tenants WHERE id = p_tenant_id;
  IF v_enc IS NULL THEN RETURN NULL; END IF;
  RETURN decrypt_provider_key(v_enc);
END;
$$;

-- ── Apple client secret: write (encrypt + store) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_set_apple_client_secret(p_tenant_id uuid, p_secret text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  UPDATE tenants
     SET auth_apple_client_secret_enc =
           CASE WHEN p_secret IS NULL OR p_secret = '' THEN NULL ELSE encrypt_provider_key(p_secret) END
   WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_apple_client_secret(uuid)           FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tenant_apple_client_secret(uuid)       TO service_role;
REVOKE ALL ON FUNCTION public.tenant_set_apple_client_secret(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.tenant_set_apple_client_secret(uuid, text) TO service_role;
