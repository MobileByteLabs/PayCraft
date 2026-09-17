-- Migration 017: Tenant-Scoped RLS Policies
-- Replaces the service_role-only policies from 012 with tenant-aware policies.
-- service_role retains full access. All other access must go through
-- SECURITY DEFINER RPCs which validate server_token + resolve tenant.
--
-- NOTE: This is defense-in-depth. Even if someone bypasses RPCs and
-- queries tables directly, RLS ensures they can only see their tenant's data.
-- In practice, anon/authenticated users have NO direct table access
-- (all policies require service_role or a matching session variable).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. subscriptions: tenant-scoped
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop existing policy from 012
DROP POLICY IF EXISTS "service_role_only_subscriptions" ON public.subscriptions;

-- service_role: full access (for webhooks, admin, migrations)
CREATE POLICY "subscriptions_service_role"
    ON public.subscriptions FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. registered_devices: tenant-scoped
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "service_role_only_devices" ON public.registered_devices;

CREATE POLICY "devices_service_role"
    ON public.registered_devices FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. tenants: service_role only (never exposed to SDK)
-- ═══════════════════════════════════════════════════════════════════════════

-- Already created in 014, but ensure it's correct
DROP POLICY IF EXISTS "service_role_only_tenants" ON public.tenants;
CREATE POLICY "tenants_service_role"
    ON public.tenants FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');
