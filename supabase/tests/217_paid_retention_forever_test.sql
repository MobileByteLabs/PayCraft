-- Assertions for migration 217: paid plans keep analytics forever ("All time" on the Analytics page), free keeps 7
-- days. Retention is what the nightly purge deletes by, so "forever" must mean the purge keeps a paid tenant's events.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/217_paid_retention_forever_test.sql
BEGIN;
DO $$
DECLARE
  paid UUID;
  free UUID;
  n    INT;
BEGIN
  -- 1. the tiers
  SELECT count(*) INTO n FROM tier_definitions
   WHERE (tier_name = 'free' AND analytics_retention_days = 7)
      OR (tier_name IN ('pro', 'enterprise') AND analytics_retention_days = 36500);
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 1: tiers not free 7 / pro + enterprise forever'; END IF;
  RAISE NOTICE 'ok 1 - free 7 days; pro and enterprise forever (36500)';

  -- 2. the purge keeps a paid tenant's two-year-old event and still removes an old free one
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, plan)
  VALUES ('p217', 'p217@x.test', 'pk_test_217a', 'pk_live_217a', 'whsec_t217a', 'whsec_l217a', 'pro') RETURNING id INTO paid;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, plan)
  VALUES ('f217', 'f217@x.test', 'pk_test_217b', 'pk_live_217b', 'whsec_t217b', 'whsec_l217b', 'free') RETURNING id INTO free;
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at)
  VALUES (paid, 'd', 'paycraft_paywall_view', 'paywall', 'android', 'live', now() - interval '730 days'),
         (free, 'd', 'paycraft_paywall_view', 'paywall', 'android', 'live', now() - interval '30 days');
  PERFORM public.paywall_events_purge();
  SELECT count(*) INTO n FROM paywall_events WHERE tenant_id = paid;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 2: the paid tenant''s old event was purged'; END IF;
  SELECT count(*) INTO n FROM paywall_events WHERE tenant_id = free;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 2b: the free tenant''s 30-day-old event survived'; END IF;
  RAISE NOTICE 'ok 2 - purge keeps paid history, still trims free at 7 days';

  RAISE NOTICE 'PASS 217_paid_retention_forever: 2/2 groups ok';
END $$;
ROLLBACK;
