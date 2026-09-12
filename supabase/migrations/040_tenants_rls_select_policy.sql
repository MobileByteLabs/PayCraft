-- Migration 040: Add SELECT RLS policy on tenants for authenticated users.
-- Fixes: requireTenant() could read tenant_admins but not tenants (service_role-only table).
-- Users may SELECT their own tenant (the one they are an admin of).

DROP POLICY IF EXISTS "tenants_admin_select" ON public.tenants;

CREATE POLICY "tenants_admin_select"
  ON public.tenants FOR SELECT
  USING (
    id IN (
      SELECT tenant_id FROM tenant_admins WHERE user_id = auth.uid()
    )
  );
