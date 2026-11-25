-- 213 — Analytics from provider truth (paycraft-attempt-observability sub-plan 07).
--
-- The Analytics page built its funnel from raw paywall_events rows fetched through the API, which returns at
-- most 1 000 rows (so "Picked a plan" read 0 beside 147 real plan picks), and took "Paid" from the app's
-- paycraft_purchase_success event, which store purchases rarely send (the store grants server-side). This
-- migration moves the funnel into SQL and takes Paid from what the providers confirmed:
--   * entitlement_records — Google Play / App Store purchases reconciled from the stores' own APIs
--   * subscriptions       — Stripe / Razorpay / other web PSP subscriptions written by their webhooks
-- It also gives both a `country` the provider reported (Play regionCode, App Store storefront, Stripe customer
-- address), and entitlement_records a first-seen time so "paid in this window" is answerable.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE.

ALTER TABLE public.entitlement_records ADD COLUMN IF NOT EXISTS country    TEXT;
ALTER TABLE public.entitlement_records ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions       ADD COLUMN IF NOT EXISTS country    TEXT;

-- Existing rows: the closest record of when the store first confirmed the purchase is the row's last write.
UPDATE public.entitlement_records SET created_at = COALESCE(created_at, updated_at, latest_event_ts, now())
 WHERE created_at IS NULL;
ALTER TABLE public.entitlement_records ALTER COLUMN created_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS entitlement_records_tenant_created_idx ON public.entitlement_records (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS subscriptions_tenant_created_idx       ON public.subscriptions (tenant_id, created_at);

-- The funnel for one app, one mode, since p_since. Buyers are distinct (user_ref, else device_ref).
--   viewed   — saw the paywall
--   picked   — picked a plan, or started checkout (a default plan is picked without a plan_select event)
--   checkout — started checkout
--   paid     — provider-confirmed purchases first seen in the window (live ⇔ not sandbox)
-- by_country: viewers/checkouts from the event's recorded country; paid from the provider's country.
-- by_provider: checkouts from the event (or its attempt's provider); paid from the provider record.
DROP FUNCTION IF EXISTS public.paywall_funnel_stats(UUID, TEXT, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.paywall_funnel_stats(
  p_tenant_id UUID, p_mode TEXT, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ DEFAULT 'infinity'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live BOOLEAN := (p_mode = 'live');
  result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH ev AS (
    SELECT COALESCE(e.user_ref, e.device_ref) AS buyer, e.name, e.country,
           COALESCE(e.provider, pa.provider) AS provider
      FROM paywall_events e
      LEFT JOIN payment_attempts pa ON pa.attempt_id = e.attempt_id AND pa.tenant_id = e.tenant_id
     WHERE e.tenant_id = p_tenant_id AND e.mode = p_mode AND e.occurred_at >= p_since AND e.occurred_at < p_until
       AND e.name IN ('paycraft_paywall_view', 'paycraft_plan_select', 'paycraft_checkout_start')
  ),
  paid AS (
    SELECT er.provider, er.country, er.app_user_id AS buyer
      FROM entitlement_records er
     WHERE er.tenant_id = p_tenant_id AND er.is_sandbox = NOT v_live AND er.created_at >= p_since AND er.created_at < p_until
       AND er.canonical_state IN ('trial', 'active', 'active_non_renewing', 'in_grace_period')
    UNION ALL
    SELECT s.provider, s.country, COALESCE(s.subject_id::text, s.email) AS buyer
      FROM subscriptions s
     WHERE s.tenant_id = p_tenant_id AND s.mode = p_mode AND s.created_at >= p_since AND s.created_at < p_until
       AND s.status IN ('active', 'trialing')
  ),
  countries AS (
    SELECT COALESCE(country, 'unknown') AS key,
           count(DISTINCT buyer) FILTER (WHERE name = 'paycraft_paywall_view')   AS viewers,
           count(DISTINCT buyer) FILTER (WHERE name = 'paycraft_checkout_start') AS checkouts,
           0::bigint AS paid
      FROM ev GROUP BY 1
    UNION ALL
    SELECT COALESCE(country, 'unknown'), 0, 0, count(DISTINCT buyer) FROM paid GROUP BY 1
  ),
  providers AS (
    SELECT COALESCE(provider, 'unknown') AS key,
           count(DISTINCT buyer) FILTER (WHERE name = 'paycraft_checkout_start') AS checkouts,
           0::bigint AS paid
      FROM ev WHERE name = 'paycraft_checkout_start' GROUP BY 1
    UNION ALL
    SELECT COALESCE(provider, 'unknown'), 0, count(DISTINCT buyer) FROM paid GROUP BY 1
  )
  SELECT jsonb_build_object(
    'viewed',   (SELECT count(DISTINCT buyer) FROM ev WHERE name = 'paycraft_paywall_view'),
    'picked',   (SELECT count(DISTINCT buyer) FROM ev WHERE name IN ('paycraft_plan_select', 'paycraft_checkout_start')),
    'checkout', (SELECT count(DISTINCT buyer) FROM ev WHERE name = 'paycraft_checkout_start'),
    'paid',     (SELECT count(*) FROM paid),
    'by_country', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'viewers', v, 'checkouts', c, 'paid', p)
                                             ORDER BY v DESC, p DESC, key)
                              FROM (SELECT key, sum(viewers) v, sum(checkouts) c, sum(paid) p
                                      FROM countries GROUP BY key) x), '[]'::jsonb),
    'by_provider', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'checkouts', c, 'paid', p)
                                              ORDER BY c DESC, p DESC, key)
                               FROM (SELECT key, sum(checkouts) c, sum(paid) p
                                       FROM providers GROUP BY key) y), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.paywall_funnel_stats(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paywall_funnel_stats(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;
