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
