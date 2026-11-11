-- 188: Google Play / App Store purchases that were cancelled or failed on the payment sheet.
--
-- Neither store tells any server about these — no purchase exists, so there is nothing to notify or
-- list (store-sync, migration 187, covers everything the stores CAN report). Only the app sees the
-- outcome, so the SDK reports it here (PayCraftBillingManager: NativePurchaseResult.Cancelled →
-- 'abandoned', .Failed → 'payment_failed') and it joins the customer list beside web attempts.
--
--   · checkout_attempts may now be keyed by app_user_id instead of email: store buyers are often an
--     anonymous device id. At least one of the two is required.
--   · record_store_attempt(api_key, …) — anon-callable like is_premium(); the app is the key's tenant,
--     live/test is the key's mode. Idempotent on the SDK's attempt id.
--   · tenant_customers_view drops an attempt once that person subscribed on the web OR holds any store
--     entitlement, and dedupes by email, else app user id.
--
-- Idempotent: ALTER … IF EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE.

ALTER TABLE public.checkout_attempts ALTER COLUMN email DROP NOT NULL;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS app_user_id TEXT;
ALTER TABLE public.checkout_attempts DROP CONSTRAINT IF EXISTS checkout_attempts_who;
ALTER TABLE public.checkout_attempts ADD CONSTRAINT checkout_attempts_who CHECK (email IS NOT NULL OR app_user_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.record_store_attempt(
    p_api_key TEXT, p_app_user_id TEXT, p_provider TEXT, p_product_id TEXT, p_outcome TEXT, p_attempt_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_tenant UUID := resolve_tenant(p_api_key);
    v_mode   TEXT;
    v_who    TEXT := btrim(coalesce(p_app_user_id, ''));
BEGIN
    IF v_tenant IS NULL
       OR p_provider NOT IN ('google_play', 'app_store')
       OR p_outcome NOT IN ('abandoned', 'payment_failed')
       OR v_who = '' OR length(v_who) > 320
       OR coalesce(p_attempt_id, '') = '' OR length(p_attempt_id) > 100
       OR length(coalesce(p_product_id, '')) > 200 THEN
        RETURN false;
    END IF;
    SELECT CASE WHEN api_key_live = p_api_key THEN 'live' ELSE 'test' END INTO v_mode FROM tenants WHERE id = v_tenant;

    INSERT INTO checkout_attempts (tenant_id, provider, mode, email, app_user_id, plan, outcome, provider_session_id)
    VALUES (v_tenant, p_provider, v_mode,
            CASE WHEN v_who LIKE '%@%' THEN lower(v_who) END, v_who,
            nullif(p_product_id, ''), p_outcome, p_attempt_id)
    ON CONFLICT (provider, provider_session_id) DO NOTHING;
    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.record_store_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_store_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;

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
-- Tried and did not finish (web checkouts + store sheets): the latest attempt per person, only while
-- they hold neither a web subscription nor any store entitlement.
SELECT * FROM (
    SELECT DISTINCT ON (a.tenant_id, a.mode, lower(coalesce(a.email, a.app_user_id)))
           a.tenant_id, a.mode, 'attempt'::text, a.id::text, a.email, a.app_user_id, a.plan, a.provider,
           a.outcome, NULL::timestamptz, a.occurred_at, a.occurred_at
    FROM checkout_attempts a
    WHERE NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.tenant_id = a.tenant_id AND s.mode = a.mode AND a.email IS NOT NULL AND lower(s.email) = a.email)
      AND NOT EXISTS (
        SELECT 1 FROM entitlement_records e
        WHERE e.tenant_id = a.tenant_id AND e.provider IN ('google_play', 'app_store')
          AND lower(e.app_user_id) IN (lower(a.app_user_id), a.email))
    ORDER BY a.tenant_id, a.mode, lower(coalesce(a.email, a.app_user_id)), a.occurred_at DESC
) attempts;

GRANT SELECT ON public.tenant_customers_view TO authenticated, service_role;
