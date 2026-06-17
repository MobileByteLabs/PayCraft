-- 066_paycraft_tenant_one.sql
--
-- Phase 1 T7 of paycraft-v2-production-readiness — provisions the PayCraft
-- platform itself as tenant #1 in its own multi-tenant database. RESEARCH.md D4
-- "PayCraft uses PayCraft" — dogfood Stripe Connect so the platform charges
-- itself via the same billing code path it offers every other tenant.
--
-- Companion runbook: docs/PAYCRAFT_AS_TENANT_ONE.md
--
-- Idempotent: re-running on a DB where the paycraft tenant already exists is
-- a no-op (per CLAUDE.md migration rules). API keys are NULL placeholders that
-- the dashboard's first /api/api-keys/rotate?mode=test|live call replaces with
-- real pk_test_* / pk_live_* values (validated by the existing tenants.api_key_*
-- UNIQUE constraints + the cryptographic rotation in app/api/api-keys/rotate/route.ts).

-- ─── tenants table — insert the PayCraft platform row ───
--
-- We use a deterministic UUID so other migrations + RLS predicates can
-- reference the platform tenant by a stable ID, not by name.
-- UUID picked: 00000000-0000-0000-0000-000000000001 (the literal "tenant #1")
DO $$
DECLARE
    paycraft_uuid CONSTANT UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id = paycraft_uuid) THEN
        INSERT INTO public.tenants (
            id,
            name,
            api_key_test,
            api_key_live,
            owner_email,
            plan,
            status,
            subscriber_limit
        ) VALUES (
            paycraft_uuid,
            'PayCraft',
            'pk_test_paycraft_placeholder_rotate_me_via_api',
            'pk_live_paycraft_placeholder_rotate_me_via_api',
            'ops@paycraft.mobilebytesensei.com',
            'enterprise',          -- platform tenant is on the highest tier (no caps)
            'active',
            2147483647             -- effectively unlimited subscribers (INT MAX)
        );

        -- Audit the bootstrap event so the audit log captures provenance.
        -- audit_log_emit RPC may not be present in pristine fresh DBs; guarded.
        IF EXISTS (
            SELECT 1 FROM pg_proc WHERE proname = 'audit_log_emit'
        ) THEN
            PERFORM audit_log_emit(
                p_tenant_id      => paycraft_uuid,
                p_actor_user_id  => NULL,
                p_actor_type     => 'system',
                p_action         => 'tenant.bootstrapped',
                p_resource       => 'tenants:id=' || paycraft_uuid::text,
                p_before         => NULL,
                p_after          => jsonb_build_object(
                    'name', 'PayCraft',
                    'plan', 'enterprise',
                    'owner_email', 'ops@paycraft.mobilebytesensei.com',
                    'source', 'migration:066_paycraft_tenant_one'
                )
            );
        END IF;
    END IF;
END $$;

-- ─── Convenience constant function — Phase 4+ code can call paycraft_tenant_id() ───
-- so subsequent migrations / RPCs don't hard-code the UUID literal.
CREATE OR REPLACE FUNCTION public.paycraft_tenant_id()
RETURNS UUID
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT '00000000-0000-0000-0000-000000000001'::UUID;
$$;

COMMENT ON FUNCTION public.paycraft_tenant_id() IS
    'Returns the deterministic UUID for the PayCraft platform tenant (tenant #1).
     Use in RPCs that need to single out the platform tenant (e.g. application_fee_amount=0
     on Stripe Connect, exempt-from-billing audits). Seeded by migration 066.';
