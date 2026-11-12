-- 186: one customer list per app — everyone who paid, subscribed in a store, or tried and did not finish.
--
-- The Subscribers page listed `subscriptions` only, which only the WEB providers write. Store buyers
-- (Google Play / App Store) live in entitlement_records and never appeared; abandoned or failed web
-- checkouts were not recorded at all. And entitlement_records had a service-role-only policy, so the
-- dashboard (an authenticated tenant admin) read zero rows and every "Entitlement" cell said "none".
--
--   1. entitlement_records gets the same tenant-admin read policy subscriptions has.
--   2. checkout_attempts records a web checkout that ended without a subscription (stripe-webhook:
--      checkout.session.expired → 'abandoned', checkout.session.async_payment_failed → 'payment_failed').
--   3. tenant_customers_view unions the three, one row per person per source, security_invoker so the
--      caller's RLS decides which apps they see.
--
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / CREATE OR REPLACE VIEW.

DROP POLICY IF EXISTS entitlement_records_tenant_admin_select ON public.entitlement_records;
CREATE POLICY entitlement_records_tenant_admin_select ON public.entitlement_records
    FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.checkout_attempts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider            TEXT NOT NULL,
    mode                TEXT NOT NULL CHECK (mode IN ('live', 'test')),
    email               TEXT NOT NULL,
    plan                TEXT,
    outcome             TEXT NOT NULL CHECK (outcome IN ('abandoned', 'payment_failed')),
    provider_session_id TEXT NOT NULL,
    occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, provider_session_id)
);
CREATE INDEX IF NOT EXISTS checkout_attempts_tenant ON public.checkout_attempts (tenant_id, mode, occurred_at DESC);

ALTER TABLE public.checkout_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS checkout_attempts_tenant_admin_select ON public.checkout_attempts;
CREATE POLICY checkout_attempts_tenant_admin_select ON public.checkout_attempts
    FOR SELECT TO authenticated
    USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE OR REPLACE VIEW public.tenant_customers_view WITH (security_invoker = true) AS
-- Web subscriptions (Stripe, Razorpay, …): the row the provider bills.
SELECT s.tenant_id, s.mode, 'subscription'::text AS source, s.id::text AS row_id,
       s.email, NULL::text AS app_user_id, s.plan, s.provider, s.status,
       s.current_period_end AS period_end, s.created_at AS started_at, s.updated_at
FROM subscriptions s
UNION ALL
-- Store buyers: the newest entitlement per (app user, store). Web entitlements mirror a subscriptions
-- row above, so only the stores are taken from here.
SELECT * FROM (
    SELECT DISTINCT ON (e.tenant_id, e.app_user_id, e.provider)
           e.tenant_id, CASE WHEN e.is_sandbox THEN 'test' ELSE 'live' END, 'store'::text, e.id::text,
           CASE WHEN e.app_user_id LIKE '%@%' THEN e.app_user_id END, e.app_user_id, e.product_id, e.provider,
           e.canonical_state, e.expires_at, MIN(e.updated_at) OVER (PARTITION BY e.tenant_id, e.app_user_id, e.provider),
           e.updated_at
    FROM entitlement_records e
    WHERE e.provider IN ('google_play', 'app_store')
    ORDER BY e.tenant_id, e.app_user_id, e.provider, e.latest_event_ts DESC
) store
UNION ALL
-- Tried and did not finish: the latest attempt per person, only if they never subscribed in that mode.
SELECT * FROM (
    SELECT DISTINCT ON (a.tenant_id, a.mode, lower(a.email))
           a.tenant_id, a.mode, 'attempt'::text, a.id::text, a.email, NULL::text, a.plan, a.provider,
           a.outcome, NULL::timestamptz, a.occurred_at, a.occurred_at
    FROM checkout_attempts a
    WHERE NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.tenant_id = a.tenant_id AND s.mode = a.mode AND lower(s.email) = lower(a.email))
    ORDER BY a.tenant_id, a.mode, lower(a.email), a.occurred_at DESC
) attempts;

GRANT SELECT ON public.tenant_customers_view TO authenticated, service_role;
