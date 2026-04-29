-- Migration 012: RLS Lockdown
-- Fixes S6 (public read on subscriptions) and S7 (missing anon deny on registered_devices)
--
-- BEFORE: subscriptions has "Public read" USING(true) — any anon/authenticated can SELECT *
-- AFTER:  Only service_role can access both tables directly.
--         All client access goes through SECURITY DEFINER RPCs (which run as service_role).

-- ═══════════════════════════════════════════════════════════════════════════
-- subscriptions: drop public read, keep service_role policy
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Public read subscriptions" ON public.subscriptions;

-- Ensure service_role policy exists (idempotent — may already exist from 001)
DROP POLICY IF EXISTS "Service role manages subscriptions" ON public.subscriptions;
CREATE POLICY "service_role_only_subscriptions"
    ON public.subscriptions FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- ═══════════════════════════════════════════════════════════════════════════
-- registered_devices: replace service_role_all, add explicit deny for others
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "service_role_all" ON registered_devices;
CREATE POLICY "service_role_only_devices"
    ON registered_devices FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- Verify: after this migration, a query as anon/authenticated role
-- on either table returns zero rows (RLS blocks all non-service_role access).
-- All data access flows through SECURITY DEFINER RPCs in 002/006.
