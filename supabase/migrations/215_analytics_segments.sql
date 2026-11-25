-- 215 — analytics segments (paycraft-ga4-analytics-audit sub-plans 01 + 02).
--
-- PayCraft's own events could not be segmented the way GA4's are: every live row had country = null (Supabase's
-- edge sends no geo header, and the events function ignored the device's region) and no app version. This adds
--   * paywall_events.app_version    — the app's user-facing version, sent once per batch by the SDK
--   * paywall_events.country_source — 'server' (edge IP-geo) or 'device' (the region the SDK reported), so a
--                                     device-reported country is never mistaken for a server-stamped one
--
-- Idempotent: ADD COLUMN IF NOT EXISTS; the CHECK is added only when missing.

ALTER TABLE public.paywall_events ADD COLUMN IF NOT EXISTS app_version    TEXT;
ALTER TABLE public.paywall_events ADD COLUMN IF NOT EXISTS country_source TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paywall_events_country_source_check') THEN
    ALTER TABLE public.paywall_events
      ADD CONSTRAINT paywall_events_country_source_check CHECK (country_source IN ('server', 'device'));
  END IF;
END $$;

-- Rows stored before 215 that have a country got it from the edge.
UPDATE public.paywall_events SET country_source = 'server' WHERE country IS NOT NULL AND country_source IS NULL;

-- The SQL mirror of the SDK's classifyStoreCode (214) learns `not_from_play` — Play answering OK with no product
-- for an app it did not install (paycraft-ga4-analytics-audit AC-3). Kept identical to PayCraftBillingManager.
CREATE OR REPLACE FUNCTION public.paycraft_store_failure_class(p_code TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_code IS NULL                              THEN 'store_other'
    WHEN p_code LIKE 'connect\_%'                    THEN 'store_connect'
    WHEN p_code LIKE 'purchase\_%'                   THEN 'store_purchase'
    WHEN p_code LIKE 'launch\_%'                     THEN 'store_launch'
    WHEN p_code LIKE 'query\_%'                      THEN 'store_query'
    WHEN p_code = 'not_from_play'                    THEN 'store_install'
    WHEN p_code = 'timeout'                          THEN 'timeout'
    WHEN p_code IN ('product_not_found', 'no_offer') THEN 'catalog'
    WHEN p_code = 'no_activity'                      THEN 'sdk_state'
    ELSE 'store_other'
  END
$$;

-- paywall_funnel_stats with the Analytics filters (sub-plan 02). Every filter is optional and narrows BOTH sides:
--   events          platform · country (case-insensitive) · app_version · plan (= the event's sku)
--   provider truth  platform from the provider (google_play → android, app_store → ios, any web PSP → web)
--                   country from the provider · plan from the subscription's plan, or the store product id mapped
--                   back to its SKU through tenant_products
-- No provider record carries an app version: an app_version filter narrows events only, and `paid_not_applied`
-- says so — the page shows it rather than presenting an unfiltered Paid as filtered.
DROP FUNCTION IF EXISTS public.paywall_funnel_stats(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ);
CREATE OR REPLACE FUNCTION public.paywall_funnel_stats(
  p_tenant_id UUID, p_mode TEXT, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ DEFAULT 'infinity',
  p_platform TEXT DEFAULT NULL, p_country TEXT DEFAULT NULL, p_app_version TEXT DEFAULT NULL, p_plan TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_live     BOOLEAN := (p_mode = 'live');
  v_platform TEXT := lower(nullif(trim(p_platform), ''));
  v_country  TEXT := upper(nullif(trim(p_country), ''));
  v_version  TEXT := nullif(trim(p_app_version), '');
  v_plan     TEXT := nullif(trim(p_plan), '');
  result JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH ev AS (
    SELECT COALESCE(e.user_ref, e.device_ref) AS buyer, e.name, e.country, e.platform, e.app_version,
           COALESCE(e.provider, pa.provider) AS provider
      FROM paywall_events e
      LEFT JOIN payment_attempts pa ON pa.attempt_id = e.attempt_id AND pa.tenant_id = e.tenant_id
     WHERE e.tenant_id = p_tenant_id AND e.mode = p_mode AND e.occurred_at >= p_since AND e.occurred_at < p_until
       AND e.name IN ('paycraft_paywall_view', 'paycraft_plan_select', 'paycraft_checkout_start')
       AND (v_platform IS NULL OR lower(e.platform) = v_platform)
       AND (v_country IS NULL OR upper(e.country) = v_country)
       AND (v_version IS NULL OR e.app_version = v_version)
       -- A plan filter keeps the plan's own events; a paywall view names no plan, so views are kept for that buyer
       -- only when they went on to pick or check out this plan.
       AND (v_plan IS NULL OR e.sku = v_plan
            OR (e.name = 'paycraft_paywall_view' AND EXISTS (
                  SELECT 1 FROM paywall_events e2
                   WHERE e2.tenant_id = e.tenant_id AND e2.mode = e.mode AND e2.sku = v_plan
                     AND COALESCE(e2.user_ref, e2.device_ref) = COALESCE(e.user_ref, e.device_ref)
                     AND e2.occurred_at >= p_since AND e2.occurred_at < p_until)))
  ),
  paid_all AS (
    SELECT er.provider, er.country, er.app_user_id AS buyer,
           COALESCE((SELECT tp.sku FROM tenant_products tp
                      WHERE tp.tenant_id = er.tenant_id
                        AND er.product_id IN (tp.play_product_id, tp.app_store_product_id) LIMIT 1), er.product_id) AS plan
      FROM entitlement_records er
     WHERE er.tenant_id = p_tenant_id AND er.is_sandbox = NOT v_live AND er.created_at >= p_since AND er.created_at < p_until
       AND er.canonical_state IN ('trial', 'active', 'active_non_renewing', 'in_grace_period')
    UNION ALL
    SELECT s.provider, s.country, COALESCE(s.subject_id::text, s.email) AS buyer, s.plan
      FROM subscriptions s
     WHERE s.tenant_id = p_tenant_id AND s.mode = p_mode AND s.created_at >= p_since AND s.created_at < p_until
       AND s.status IN ('active', 'trialing')
  ),
  paid AS (
    SELECT p.*, CASE p.provider WHEN 'google_play' THEN 'android' WHEN 'app_store' THEN 'ios' ELSE 'web' END AS platform
      FROM paid_all p
     WHERE (v_country IS NULL OR upper(p.country) = v_country)
       AND (v_plan IS NULL OR p.plan = v_plan)
       AND (v_platform IS NULL
            OR CASE p.provider WHEN 'google_play' THEN 'android' WHEN 'app_store' THEN 'ios' ELSE 'web' END = v_platform)
  ),
  seg AS (
    SELECT 'country' AS dim, COALESCE(upper(country), 'unknown') AS key, buyer, name, 0 AS paid FROM ev
    UNION ALL SELECT 'platform', COALESCE(lower(platform), 'unknown'), buyer, name, 0 FROM ev
    UNION ALL SELECT 'app_version', COALESCE(app_version, 'unknown'), buyer, name, 0 FROM ev
    UNION ALL SELECT 'provider', COALESCE(provider, 'unknown'), buyer, name, 0 FROM ev WHERE name = 'paycraft_checkout_start'
    UNION ALL SELECT 'country', COALESCE(upper(country), 'unknown'), buyer, NULL, 1 FROM paid
    UNION ALL SELECT 'platform', platform, buyer, NULL, 1 FROM paid
    UNION ALL SELECT 'provider', COALESCE(provider, 'unknown'), buyer, NULL, 1 FROM paid
  ),
  seg_rows AS (
    SELECT dim, key,
           count(DISTINCT buyer) FILTER (WHERE name = 'paycraft_paywall_view')   AS viewers,
           count(DISTINCT buyer) FILTER (WHERE name = 'paycraft_checkout_start') AS checkouts,
           count(*) FILTER (WHERE paid = 1)                                    AS paid
      FROM seg GROUP BY dim, key
  )
  SELECT jsonb_build_object(
    'viewed',   (SELECT count(DISTINCT buyer) FROM ev WHERE name = 'paycraft_paywall_view'),
    'picked',   (SELECT count(DISTINCT buyer) FROM ev WHERE name IN ('paycraft_plan_select', 'paycraft_checkout_start')),
    'checkout', (SELECT count(DISTINCT buyer) FROM ev WHERE name = 'paycraft_checkout_start'),
    'paid',     (SELECT count(*) FROM paid),
    'paid_not_applied', CASE WHEN v_version IS NULL THEN '[]'::jsonb ELSE '["app_version"]'::jsonb END,
    'by_country', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'viewers', viewers, 'checkouts', checkouts, 'paid', paid)
                                             ORDER BY viewers DESC, paid DESC, key)
                              FROM seg_rows WHERE dim = 'country'), '[]'::jsonb),
    'by_platform', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'viewers', viewers, 'checkouts', checkouts, 'paid', paid)
                                              ORDER BY viewers DESC, paid DESC, key)
                               FROM seg_rows WHERE dim = 'platform'), '[]'::jsonb),
    'by_app_version', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'viewers', viewers, 'checkouts', checkouts)
                                                 ORDER BY viewers DESC, key)
                                  FROM seg_rows WHERE dim = 'app_version'), '[]'::jsonb),
    'by_provider', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', key, 'checkouts', checkouts, 'paid', paid)
                                              ORDER BY checkouts DESC, paid DESC, key)
                               FROM seg_rows WHERE dim = 'provider'), '[]'::jsonb)
  ) INTO result;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.paywall_funnel_stats(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paywall_funnel_stats(UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT)
  TO authenticated, service_role;
