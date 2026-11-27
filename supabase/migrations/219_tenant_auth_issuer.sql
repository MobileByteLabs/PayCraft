-- 219 — set tenants.auth_issuer_url (PLAN paycraft-consumer-supabase-identity G4).
--
-- Buyers sign in to the CONSUMER app's Supabase; identity-verify checks that session against the tenant's
-- issuer JWKS (162). The column had no writer: anon cannot set it (162) and nothing else did, so every
-- tenant answered `verified_identity_not_configured`. Provisioning (/idea-paycraft · /idea-auth CI-3) sets it
-- here, service role only. The value is the consumer project's base URL — identity-verify appends
-- `/auth/v1/.well-known/jwks.json` and checks `iss = <base>/auth/v1` — so it must be a bare https origin.
-- NULL / blank clears it (the tenant stops verifying sessions).
--
-- auth_issuer_set_at records WHEN: identity-verify refuses every session until the issuer is set, so an
-- auth_user identity created after it can only have come through a consumer session — the proof CI-7 reads
-- (an older PayCraft-own sign-in also left UUID auth_users, so the id alone proves nothing).

ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS auth_issuer_set_at timestamptz;

CREATE OR REPLACE FUNCTION public.tenant_set_auth_issuer(p_tenant_id uuid, p_issuer text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issuer text := NULLIF(rtrim(btrim(p_issuer), '/'), '');
BEGIN
  IF v_issuer IS NOT NULL AND v_issuer !~ '^https://[A-Za-z0-9.-]+$' THEN
    RAISE EXCEPTION 'auth issuer must be a bare https origin (e.g. https://<ref>.supabase.co), got %', v_issuer
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  UPDATE public.tenants
     SET auth_issuer_set_at = CASE WHEN auth_issuer_url IS DISTINCT FROM v_issuer THEN now() ELSE auth_issuer_set_at END,
         auth_issuer_url = v_issuer
   WHERE id = p_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tenant % not found', p_tenant_id USING ERRCODE = 'no_data_found';
  END IF;
  RETURN v_issuer;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_set_auth_issuer(uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_set_auth_issuer(uuid, text) TO service_role;
