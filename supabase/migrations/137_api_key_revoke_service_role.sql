-- 137_api_key_revoke_service_role.sql
--
-- Let the service role REVOKE a management key, not just create one.
--
-- 136 gave `tenant_api_key_create` a service_role branch (the first key cannot be minted by a key
-- that does not exist yet) but left `tenant_api_key_revoke` admin-only. That asymmetry is backwards
-- in the direction that matters: it means automation can MINT a live-money credential but cannot
-- KILL one. Revocation is the emergency path — the thing you reach for when a key is in a log, a
-- CI artifact, or a leaked file — and it must never be the harder of the two to reach.
--
-- It was not hypothetical. A key minted seconds after 136 applied could not be revoked by the same
-- caller that created it, leaving a dangling credential whose only remaining kill switch was a
-- human logging in with Google — the exact dependency this whole feature exists to remove.
--
-- Same reasoning as 136's create branch: service_role already bypasses RLS and can UPDATE this
-- table directly, so this grants no new power. It routes the operation through the audited path
-- instead of a hand-rolled UPDATE that would skip the audit row.

CREATE OR REPLACE FUNCTION public.tenant_api_key_revoke(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT k.tenant_id INTO v_tenant FROM tenant_api_keys k WHERE k.id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unknown_key'; END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
     ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE tenant_api_keys SET revoked_at = now() WHERE id = p_id AND revoked_at IS NULL;

  PERFORM audit_log_emit(v_tenant, auth.uid(),
                         CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
                         'api_key.revoked',
                         'tenant_api_keys:id=' || p_id::TEXT, NULL, NULL);
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_api_key_revoke(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_api_key_revoke(UUID) TO authenticated, service_role;
