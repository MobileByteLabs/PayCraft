-- 086_provider_account_label.sql
-- A non-secret, human-friendly "which account is this?" label per provider
-- connection, shown in the app-switcher / "reuse providers" picker. Google Play
-- auto-captures the service-account email; the web PSPs + App Store have no
-- natural email, so the operator can name the connection here.
--
-- tenant_providers is service-role-write only (RLS), so the dashboard sets the
-- label through this SECURITY DEFINER RPC. Same auth pattern as the other write
-- RPCs: an authenticated caller must own the tenant; the trusted backend (auth.uid
-- null) is allowed.

CREATE OR REPLACE FUNCTION public.tenant_providers_set_account_label(
  p_tenant_id UUID, p_provider TEXT, p_label TEXT
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE public.tenant_providers
     SET store_config = COALESCE(store_config, '{}'::jsonb)
                        || jsonb_build_object('account_label', NULLIF(btrim(p_label), '')),
         updated_at = now()
   WHERE tenant_id = p_tenant_id AND provider = p_provider;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_providers_set_account_label(UUID,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_providers_set_account_label(UUID,TEXT,TEXT) TO authenticated, service_role;
