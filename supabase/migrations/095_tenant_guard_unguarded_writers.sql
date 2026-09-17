-- 095_tenant_guard_unguarded_writers.sql
--
-- Closes the residual risk 094 deliberately left open and named.
--
-- 094 revoked anon EXECUTE, which stopped a stranger holding the public anon key. It did NOT stop a
-- LOGGED-IN user from passing someone else's tenant UUID, because these functions take tenant_id on
-- trust. This migration adds the tenant guard, so authorisation no longer depends on the caller
-- being polite about which UUID they send.
--
-- SCOPE — three functions, not forty.
-- A scan for "authenticated-reachable writer without the canonical guard" returns 40. That number
-- is not actionable, because two DIFFERENT guard families are in use and only one is missing here:
--   * dashboard-admin RPCs guard with tenant_admins + auth.uid()  (the shape added below);
--   * SDK-facing RPCs (register_device, check_premium_with_device, transfer_to_device, …) guard by
--     validating a SERVER TOKEN, and are called by shipped apps with the anon key BY DESIGN.
-- Bolting a tenant_admins check onto the second family would break entitlement checks in every
-- consumer app in the field. Filtering to writers that are tenant-scoped, authenticated-reachable,
-- and carry NO authorisation of either family leaves exactly these three.
-- (A fourth candidate, is_premium_by_app_user, is a LANGUAGE sql STABLE single-SELECT — a reader
-- misclassified by the scan's regex, not a writer. See 094's note 3.)
--
-- WHY THE GUARD IS SHAPED `auth.uid() IS NOT NULL AND NOT EXISTS(...)`
-- Copied verbatim from 084/087. The `auth.uid() IS NOT NULL AND` prefix is load-bearing: Edge
-- Functions and dashboard onboarding routes call these as service_role, where auth.uid() is NULL.
-- Migration 083 shipped the guard WITHOUT that prefix and locked out its own backend callers; 084
-- exists solely to repair it. Do not "simplify" this condition — the short-circuit IS the fix.
--
-- LANGUAGE CHANGE
-- All three were LANGUAGE sql, which has no IF/RAISE. Each becomes plpgsql with the identical
-- signature (argument names, types, and DEFAULTs preserved), so existing callers and GRANTs are
-- unaffected — CREATE OR REPLACE keeps the privileges already attached to the function.

-- ── audit_log_emit — writes an audit row for a caller-supplied tenant ────────────────────────
-- Called from 23 dashboard server routes, every one AFTER requireTenant() has already established
-- the caller's tenant; the guard makes that invariant enforceable at the database rather than
-- assumed from the route.
CREATE OR REPLACE FUNCTION audit_log_emit(
  p_tenant_id     UUID,
  p_actor_user_id UUID,
  p_actor_type    TEXT,
  p_action        TEXT,
  p_resource      TEXT,
  p_before        JSONB DEFAULT NULL,
  p_after         JSONB DEFAULT NULL,
  p_ip            INET DEFAULT NULL,
  p_user_agent    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO tenant_audit_log(
    tenant_id, actor_user_id, actor_type, action, resource,
    before_jsonb, after_jsonb, ip_address, user_agent
  )
  VALUES (
    p_tenant_id, p_actor_user_id, p_actor_type, p_action, p_resource,
    p_before, p_after, p_ip, p_user_agent
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── refresh_tenant_entitlements — rewrites a tenant's entitlement set ────────────────────────
CREATE OR REPLACE FUNCTION refresh_tenant_entitlements(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE tenants t
     SET entitlements = COALESCE(
       (SELECT td.entitlements FROM tier_definitions td WHERE td.tier_name = t.plan),
       '[]'::jsonb
     )
   WHERE t.id = p_tenant_id;
END;
$$;

-- ── tenant_paywall_ensure_default — inserts a tenant's default paywall row ───────────────────
CREATE OR REPLACE FUNCTION tenant_paywall_ensure_default(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO tenant_paywall(tenant_id) VALUES (p_tenant_id) ON CONFLICT DO NOTHING;
END;
$$;
