-- Migration 174: edit the scopes of an EXISTING pcsk_ key in place.
--
-- WHY. Until now a key's scopes were fixed at creation. The only way to grant a new permission was
-- mint-new + revoke, which forces every consumer (CI secret, agent config) to be re-provisioned —
-- and 173 added scopes (onboarding:read/write, apps:write) that the operator's existing account
-- token could not gain. The key VALUE does not change here; only `scopes` does. key_hash,
-- key_prefix, expiry and owner are untouched, so nothing holding the key needs updating.
--
-- ONE RPC FOR BOTH KEY SHAPES (136 app-scoped, 150 account-scoped):
--   • account key (owner_user_id set) → only its owner may edit it
--   • app key     (tenant_id set)     → an owner/admin of that tenant (viewers may not)
-- Unauthorised and non-existent both raise 'forbidden', so the RPC is not an existence oracle.
--
-- VOCABULARY. The closed scope list stays in ONE place — the tenant_api_keys_scopes_known CHECK.
-- This function does not copy it; it catches that constraint's violation and re-raises it as
-- 'unknown_scope'.
--
-- AUDIT. tenant_audit_log.tenant_id is NOT NULL (033) and audit_log_emit requires the caller to
-- administer the tenant (095), so an account key — which has no tenant — cannot be logged as a
-- single NULL-tenant row. Instead the change is written to the audit log of EVERY app the key
-- reaches (the owner's owner/admin tenants, the same set tenant_api_key_verify computes). That is
-- where an app's admins look, and it is exactly the set of apps whose exposure just changed.
--
-- Idempotent: CREATE OR REPLACE + REVOKE/GRANT.

CREATE OR REPLACE FUNCTION public.api_key_set_scopes(p_id UUID, p_scopes TEXT[])
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_row     tenant_api_keys%ROWTYPE;
  v_scopes  TEXT[];
  v_tenant  UUID;
  v_constr  TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  SELECT * INTO v_row FROM tenant_api_keys WHERE id = p_id;

  -- Same error for "no such key" and "not yours": the caller learns nothing about other keys.
  IF v_row.id IS NULL
     OR (v_row.owner_user_id IS NOT NULL AND v_row.owner_user_id <> v_user_id)
     OR (v_row.owner_user_id IS NULL AND NOT EXISTS (
           SELECT 1 FROM tenant_admins
            WHERE tenant_id = v_row.tenant_id AND user_id = v_user_id AND role IN ('owner','admin')))
  THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF v_row.revoked_at IS NOT NULL OR (v_row.expires_at IS NOT NULL AND v_row.expires_at <= now()) THEN
    RAISE EXCEPTION 'key_not_active';
  END IF;

  v_scopes := ARRAY(SELECT DISTINCT s FROM unnest(p_scopes) s WHERE s IS NOT NULL AND s <> '' ORDER BY s);
  IF COALESCE(array_length(v_scopes, 1), 0) = 0 THEN RAISE EXCEPTION 'scopes_required'; END IF;

  BEGIN
    UPDATE tenant_api_keys SET scopes = v_scopes WHERE id = p_id;
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_constr = CONSTRAINT_NAME;
    IF v_constr = 'tenant_api_keys_scopes_known' THEN RAISE EXCEPTION 'unknown_scope'; END IF;
    RAISE;
  END;

  IF v_row.tenant_id IS NOT NULL THEN
    PERFORM audit_log_emit(v_row.tenant_id, v_user_id, 'user', 'api_key.scopes_updated',
                           'tenant_api_keys:id=' || p_id::TEXT,
                           jsonb_build_object('scopes', v_row.scopes),
                           jsonb_build_object('scopes', v_scopes));
  ELSE
    FOR v_tenant IN
      SELECT tenant_id FROM tenant_admins WHERE user_id = v_user_id AND role IN ('owner','admin')
    LOOP
      PERFORM audit_log_emit(v_tenant, v_user_id, 'user', 'api_key.scopes_updated',
                             'tenant_api_keys:id=' || p_id::TEXT,
                             jsonb_build_object('scopes', v_row.scopes),
                             jsonb_build_object('scopes', v_scopes, 'account_scoped', true));
    END LOOP;
  END IF;

  RETURN v_scopes;
END;
$$;

COMMENT ON FUNCTION public.api_key_set_scopes(UUID, TEXT[]) IS
  'Replace the scopes of an active pcsk_ key in place (key value unchanged). Account keys: owner '
  'only. App keys: tenant owner/admin. Errors: unauthenticated | forbidden | key_not_active | '
  'scopes_required | unknown_scope (migration 174).';

REVOKE ALL ON FUNCTION public.api_key_set_scopes(UUID, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.api_key_set_scopes(UUID, TEXT[]) TO authenticated;
