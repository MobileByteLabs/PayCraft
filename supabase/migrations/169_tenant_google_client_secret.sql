-- 169 — the APP's Google Web client secret, per tenant, encrypted (twin of 168's Apple secret).
--
-- The identity-token browser flow (Google on iOS / desktop / web) now runs on the APP's own Google
-- Web client (tenants.auth_google_web_client_id, migration 167), so Google's consent screen names the
-- app the buyer installed — not "PayCraft". Exchanging the code needs that client's secret. It is a
-- credential: stored only encrypted (encrypt_provider_key), readable only by service_role. A tenant
-- without one falls back to PayCraft's own Web client (edge env PAYCRAFT_GOOGLE_WEB_CLIENT_*).
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS auth_google_client_secret_enc bytea;

CREATE OR REPLACE FUNCTION public.tenant_google_client_secret(p_tenant_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT CASE WHEN auth_google_client_secret_enc IS NULL THEN NULL
              ELSE public.decrypt_provider_key(auth_google_client_secret_enc) END
  FROM public.tenants WHERE id = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION public.tenant_set_google_client_secret(p_tenant_id uuid, p_secret text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  UPDATE public.tenants
     SET auth_google_client_secret_enc =
         CASE WHEN coalesce(btrim(p_secret), '') = '' THEN NULL
              ELSE public.encrypt_provider_key(btrim(p_secret)) END
   WHERE id = p_tenant_id;
$$;

REVOKE ALL ON FUNCTION public.tenant_google_client_secret(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_set_google_client_secret(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_google_client_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_set_google_client_secret(uuid, text) TO service_role;
