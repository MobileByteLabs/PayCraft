-- 175 — revoking an ACCOUNT-scoped key actually revokes it.
--
-- The dashboard's account-token DELETE ran `UPDATE tenant_api_keys SET revoked_at = now()` with the
-- signed-in user's client. tenant_api_keys has RLS with a single SELECT policy (tenant_api_keys_read),
-- so that UPDATE matched zero rows, raised no error, and the route answered {revoked: true} — the
-- token stayed live. Confirmed against production 2026-11-07 (pg_policies: SELECT only); no account
-- token had been revoked yet, so nothing was left falsely "revoked".
--
-- App keys already revoke through tenant_api_key_revoke (137), which refused account keys because
-- they have no tenant ('unknown_key'). This extends that ONE function rather than adding a second
-- revoke path:
--   • app key     → unchanged: a tenant admin (or service_role) may revoke; audit in that tenant
--   • account key → only its owner (service_role too); audit in every tenant the owner administers,
--                   which is the set the token reached (same model as 174's scope edits)
-- A key that does not exist, or is not yours, still answers 'forbidden'/'unknown_key' as before for
-- app keys; for account keys "not yours" is 'forbidden', never a silent success.

CREATE OR REPLACE FUNCTION public.tenant_api_key_revoke(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     tenant_api_keys%ROWTYPE;
  v_service BOOLEAN := auth.role() IS NOT DISTINCT FROM 'service_role';
  v_tenant  UUID;
BEGIN
  SELECT * INTO v_row FROM tenant_api_keys k WHERE k.id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'unknown_key'; END IF;

  IF v_row.tenant_id IS NOT NULL THEN
    -- App key: 137's rule, verbatim.
    IF NOT v_service AND NOT EXISTS (
         SELECT 1 FROM tenant_admins WHERE tenant_id = v_row.tenant_id AND user_id = auth.uid()
       ) THEN RAISE EXCEPTION 'forbidden'; END IF;

    UPDATE tenant_api_keys SET revoked_at = now() WHERE id = p_id AND revoked_at IS NULL;

    PERFORM audit_log_emit(v_row.tenant_id, auth.uid(),
                           CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
                           'api_key.revoked',
                           'tenant_api_keys:id=' || p_id::TEXT, NULL, NULL);
    RETURN TRUE;
  END IF;

  -- Account key: owner only.
  IF NOT v_service AND (auth.uid() IS NULL OR v_row.owner_user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE tenant_api_keys SET revoked_at = now() WHERE id = p_id AND revoked_at IS NULL;

  FOR v_tenant IN
    SELECT tenant_id FROM tenant_admins
     WHERE user_id = v_row.owner_user_id AND role IN ('owner','admin')
  LOOP
    PERFORM audit_log_emit(v_tenant, auth.uid(),
                           CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
                           'api_key.revoked',
                           'tenant_api_keys:id=' || p_id::TEXT, NULL,
                           jsonb_build_object('account_scoped', true));
  END LOOP;
  RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_api_key_revoke(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_api_key_revoke(UUID) TO authenticated, service_role;
