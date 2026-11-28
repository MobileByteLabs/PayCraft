-- Assertions for migration 225: the bucketed Live series and the "where buyers leave" breakdown.
--
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/migrations/225_live_ranges_exit_steps.sql
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/225_live_ranges_exit_steps_test.sql
BEGIN;
DO $$
DECLARE
  t        UUID;
  admin    UUID := gen_random_uuid();
  outsider UUID := gen_random_uuid();
  other    UUID;
  n        INT;
  r        RECORD;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t225', 'o225@x.test', 'pk_test_225a', 'pk_live_225a', 'whsec_t225a', 'whsec_l225a') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('o225', 'p225@x.test', 'pk_test_225b', 'pk_live_225b', 'whsec_t225b', 'whsec_l225b') RETURNING id INTO other;
  INSERT INTO auth.users (id, email) VALUES (admin, 'admin225@test.local'), (outsider, 'out225@test.local');
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (t, admin, 'owner'), (other, outsider, 'owner');

  -- Two days of traffic: 3 views today (2 devices), 1 yesterday; exits at two steps; one test-mode row ignored.
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, reason, sku) VALUES
    (t, 'd1', 'paycraft_paywall_view',  'paywall',  'android', 'live', now() - interval '10 minutes', '2026.11.28', NULL, NULL),
    (t, 'd1', 'paycraft_paywall_view',  'paywall',  'android', 'live', now() - interval '9 minutes',  '2026.11.28', NULL, NULL),
    (t, 'd2', 'paycraft_paywall_view',  'paywall',  'android', 'live', now() - interval '8 minutes',  NULL,         NULL, NULL),
    (t, 'd3', 'paycraft_paywall_view',  'paywall',  'android', 'live', now() - interval '26 hours',   '2026.11.25', NULL, NULL),
    (t, 'd1', 'paycraft_step_abandon',  'plan',     'android', 'live', now() - interval '7 minutes',  '2026.11.28', NULL, 'pro-quarterly'),
    (t, 'd2', 'paycraft_step_abandon',  'plan',     'android', 'live', now() - interval '6 minutes',  NULL,         NULL, 'pro-quarterly'),
    (t, 'd1', 'paycraft_step_abandon',  'checkout', 'android', 'live', now() - interval '5 minutes',  '2026.11.28', 'store_cancelled', 'pro-monthly'),
    (t, 'd1', 'paycraft_offer_decline', 'offer',    'android', 'live', now() - interval '4 minutes',  '2026.11.28', NULL, NULL),
    (t, 'd9', 'paycraft_step_abandon',  'plan',     'android', 'test', now() - interval '3 minutes',  '2026.11.28', NULL, 'pro-quarterly');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- 1. day buckets over 2 days: the views land in two buckets; a null version is 'unknown'
  SELECT count(DISTINCT bucket) INTO n FROM public.paywall_live_series(t, now() - interval '2 days', 'live', 'day')
   WHERE name = 'paycraft_paywall_view';
  IF n < 1 OR n > 3 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 1a: % day buckets', n; END IF;
  SELECT coalesce(sum(events), 0) INTO n FROM public.paywall_live_series(t, now() - interval '2 days', 'live', 'day')
   WHERE name = 'paycraft_paywall_view';
  IF n <> 4 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 1b: % views over 2 days (want 4)', n; END IF;
  SELECT count(*) INTO n FROM public.paywall_live_series(t, now() - interval '1 hour', 'live', 'hour')
   WHERE name = 'paycraft_paywall_view' AND app_version = 'unknown';
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 1c: null version not reported as unknown'; END IF;
  RAISE NOTICE 'ok 1 - bucketed series counts per bucket and reports a missing version as unknown';

  -- 2. a bad bucket is refused
  BEGIN
    PERFORM * FROM public.paywall_live_series(t, now() - interval '1 hour', 'live', 'week');
    RESET ROLE; RAISE EXCEPTION 'FAIL 2: bucket week accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  RAISE NOTICE 'ok 2 - only minute / hour / day buckets';

  -- 3. exits: plan step left by 2 devices on Quarterly, the store cancel on Monthly, the offer decline; test mode out
  SELECT devices INTO n FROM public.paywall_exit_steps(t, now() - interval '1 hour', 'live')
   WHERE name = 'paycraft_step_abandon' AND step = 'plan' AND sku = 'pro-quarterly';
  IF n IS DISTINCT FROM 2 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 3a: plan exits on quarterly = %', n; END IF;
  SELECT count(*) INTO n FROM public.paywall_exit_steps(t, now() - interval '1 hour', 'live')
   WHERE step = 'checkout' AND reason = 'store_cancelled' AND sku = 'pro-monthly';
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 3b: store cancel row missing'; END IF;
  SELECT count(*) INTO n FROM public.paywall_exit_steps(t, now() - interval '1 hour', 'live')
   WHERE name = 'paycraft_offer_decline';
  IF n <> 1 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 3c: offer decline missing'; END IF;
  SELECT coalesce(sum(exits), 0) INTO n FROM public.paywall_exit_steps(t, now() - interval '1 hour', 'live');
  IF n <> 4 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 3d: % exits (want 4; test mode and views excluded)', n; END IF;
  SELECT * INTO r FROM public.paywall_exit_steps(t, now() - interval '1 hour', 'live') LIMIT 1;
  IF r.devices <> 2 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 3e: biggest exit not first (got % devices)', r.devices; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok 3 - exits grouped by step / reason / plan, most devices first, live only';

  -- 4. an admin of another tenant may call neither
  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.paywall_live_series(t, now() - interval '1 hour', 'live', 'hour');
    RESET ROLE; RAISE EXCEPTION 'FAIL 4a: non-member called paywall_live_series';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.paywall_exit_steps(t, now() - interval '1 hour', 'live');
    RESET ROLE; RAISE EXCEPTION 'FAIL 4b: non-member called paywall_exit_steps';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  RAISE NOTICE 'ok 4 - non-members refused';

  -- 5. anon has no EXECUTE
  IF has_function_privilege('anon', 'public.paywall_live_series(uuid, timestamptz, text, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.paywall_exit_steps(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5: anon can execute';
  END IF;
  RAISE NOTICE 'ok 5 - anon denied';

  RAISE NOTICE 'PASS 225_live_ranges_exit_steps: 5/5 groups ok';
END $$;
ROLLBACK;
