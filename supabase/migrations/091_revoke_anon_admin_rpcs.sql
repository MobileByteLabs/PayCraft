-- 091_revoke_anon_admin_rpcs.sql — close an anonymous write path into tenant-owned tables.
--
-- THE DEFECT
-- Migration 084 relaxed the 083 ownership guards so a TRUSTED BACKEND (service_role / raw psql,
-- where auth.uid() IS NULL) could seed products and pricing. It did so with
--     IF auth.uid() IS NOT NULL AND NOT EXISTS (tenant_admins match) THEN RAISE 'forbidden'
-- and justified it in its own header with: "anon can't reach these RPCs (granted to
-- `authenticated` only)."
--
-- That premise was never true. PostgreSQL grants EXECUTE to PUBLIC by default on CREATE FUNCTION,
-- so `anon` held EXECUTE the whole time. And because the guard short-circuits on a NULL uid, anon
-- — whose uid is also NULL — takes the same trusted path the backend does.
--
-- Reproduced on a local instance before this fix:
--     SET LOCAL ROLE anon;
--     SELECT public.tenant_products_upsert(jsonb_build_object('tenant_id', <someone else's>, ...));
--     -- returns a fresh uuid; the row is written.
-- Reachable in production as `POST /rest/v1/rpc/tenant_products_upsert` with the PUBLISHABLE anon
-- key, which by design ships inside every client app. So any holder of a public key could write,
-- and in some cases overwrite, any tenant's catalogue.
--
-- THE FIX, AND WHY IT IS A REVOKE RATHER THAN A GUARD REWRITE
-- The grant is the actual root cause: 084's logic is correct *given* its stated premise, and the
-- premise is what failed. Restoring it — anon simply cannot call these — repairs the reasoning
-- without touching five guard bodies whose backend-bypass behaviour is load-bearing for the
-- onboarding CLI and the service-role dashboard client. Narrow change, no behavioural risk to
-- `authenticated` (session role is `authenticated`, not `anon`) or to `service_role`.
--
-- Idempotent: REVOKE on an absent privilege is a no-op.
--
-- NOT the whole story — see the audit note in the epic: 51 SECURITY DEFINER writers are
-- anon-executable. Most are safe because they use the CORRECT guard shape
-- (`IF NOT EXISTS (... auth.uid()) THEN RAISE`, no short-circuit), which rejects a NULL uid.
-- The five below are the ones carrying the bypassable `auth.uid() IS NOT NULL AND` shape.
-- A full sweep of the remaining surface is tracked separately and deliberately NOT bundled here.

REVOKE EXECUTE ON FUNCTION public.tenant_products_upsert(jsonb)            FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_pricing_upsert(jsonb)             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_products_delete(uuid)             FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_event_emit(uuid, uuid, uuid, text, text, text, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_providers_set_account_label(uuid, text, text) FROM anon, PUBLIC;

-- Re-assert the intended callers explicitly, so a later CREATE OR REPLACE that resets grants
-- cannot silently restore PUBLIC without also restoring these.
GRANT EXECUTE ON FUNCTION public.tenant_products_upsert(jsonb)            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_pricing_upsert(jsonb)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_products_delete(uuid)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_event_emit(uuid, uuid, uuid, text, text, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_providers_set_account_label(uuid, text, text) TO authenticated, service_role;

-- Also close the 089 core, which is SECURITY DEFINER with NO ownership guard at all.
REVOKE EXECUTE ON FUNCTION public._tenant_products_upsert_core(jsonb) FROM anon, authenticated, PUBLIC;
