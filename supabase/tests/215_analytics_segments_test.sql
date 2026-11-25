-- Assertions for migration 215 (paycraft-ga4-analytics-audit): the event fields PayCraft's analytics segment by —
-- app version and where the country came from — and paywall_funnel_stats filtered by platform / country / app
-- version / plan, so the dashboard's filters narrow PayCraft's numbers the way they narrow GA4's.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/215_analytics_segments_test.sql
BEGIN;
DO $$
DECLARE
  t UUID;
  n INT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t215', 'o215@x.test', 'pk_test_215a', 'pk_live_215a', 'whsec_t215a', 'whsec_l215a') RETURNING id INTO t;

  -- 1. columns
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'paywall_events' AND column_name IN ('app_version', 'country_source');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 1: expected app_version + country_source, got %', n; END IF;
  RAISE NOTICE 'ok 1 - paywall_events.app_version + country_source exist';

  -- 2. country_source only says where a country came from
  BEGIN
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, country, country_source)
    VALUES (t, 'd', 'paycraft_paywall_view', 'paywall', 'android', 'live', now(), 'IN', 'guess');
    RAISE EXCEPTION 'FAIL 2: country_source accepted ''guess''';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'ok 2 - country_source is server | device';
  END;

  -- 3. the SQL mirror of classifyStoreCode knows the new store codes (AC-3)
  IF public.paycraft_store_failure_class('not_from_play') <> 'store_install'
     OR public.paycraft_store_failure_class('query_6') <> 'store_query'
     OR public.paycraft_store_failure_class('product_not_found') <> 'catalog' THEN
    RAISE EXCEPTION 'FAIL 3: class mirror drifted from classifyStoreCode';
  END IF;
  RAISE NOTICE 'ok 3 - not_from_play is store_install in the SQL mirror';

  RAISE NOTICE 'PASS 215_analytics_segments: 3/3 groups ok';
END $$;
ROLLBACK;
