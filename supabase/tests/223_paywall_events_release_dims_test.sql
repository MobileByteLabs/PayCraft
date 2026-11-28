-- Assertions for migration 223 (realtime analytics): the release dimensions on paywall_events, the two Live-page
-- RPCs, the realtime publication, and that neither the RPCs nor RLS let anyone read another tenant's events.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/223_paywall_events_release_dims_test.sql
BEGIN;
DO $$
DECLARE
  t      UUID;
  other  UUID;
  admin  UUID := gen_random_uuid();
  outsider UUID := gen_random_uuid();
  m      TIMESTAMPTZ := date_trunc('minute', now()) - interval '10 minutes';
  n      INT;
  r      RECORD;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t223', 'o223@x.test', 'pk_test_223a', 'pk_live_223a', 'whsec_t223a', 'whsec_l223a') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('o223', 'p223@x.test', 'pk_test_223b', 'pk_live_223b', 'whsec_t223b', 'whsec_l223b') RETURNING id INTO other;
  INSERT INTO auth.users (id, email) VALUES (admin, 'admin223@test.local'), (outsider, 'out223@test.local');
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (t, admin, 'owner'), (other, outsider, 'owner');

  -- 1. columns
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'paywall_events'
     AND column_name IN ('app_version', 'app_build', 'os_version');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 1: expected app_version + app_build + os_version, got %', n; END IF;
  RAISE NOTICE 'ok 1 - paywall_events.app_version + app_build + os_version exist';

  -- 2. caps: version ≤ 40, build ≥ 0, OS ≤ 20
  BEGIN
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version)
    VALUES (t, 'd', 'paycraft_paywall_view', 'paywall', 'android', 'live', now(), repeat('9', 41));
    RAISE EXCEPTION 'FAIL 2a: a 41-char app_version was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_build)
    VALUES (t, 'd', 'paycraft_paywall_view', 'paywall', 'android', 'live', now(), -1);
    RAISE EXCEPTION 'FAIL 2b: a negative app_build was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, os_version)
    VALUES (t, 'd', 'paycraft_paywall_view', 'paywall', 'android', 'live', now(), repeat('1', 21));
    RAISE EXCEPTION 'FAIL 2c: a 21-char os_version was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  RAISE NOTICE 'ok 2 - app_version ≤ 40, app_build ≥ 0, os_version ≤ 20';

  -- 3. index + realtime publication
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'paywall_events_tenant_version_time') THEN
    RAISE EXCEPTION 'FAIL 3: index paywall_events_tenant_version_time missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'paywall_events') THEN
    RAISE EXCEPTION 'FAIL 3: paywall_events is not in supabase_realtime'; END IF;
  RAISE NOTICE 'ok 3 - version index exists; paywall_events is in supabase_realtime';

  -- Seed (live, inside the window unless noted):
  --   1.0: d1 view + purchase + restore found · d2 views twice in one minute · d3 sign-in view + fail
  --   2.0: d4 view + restore not_found · d5 view + purchase + sign-in ok · d6 device limit + transfer done · d8 view
  --   null version: d7 view
  --   noise: a test-mode row, a row before the window, another tenant's row — none may be counted
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, app_build, os_version, reason)
  VALUES
    (t, 'd1', 'paycraft_paywall_view',      'paywall',      'android', 'live', m,                         '1.0', 10, '14', NULL),
    (t, 'd1', 'paycraft_purchase_success',  'checkout',     'android', 'live', m + interval '1 minute',   '1.0', 10, '14', NULL),
    (t, 'd1', 'paycraft_restore_result',    'restore',      'android', 'live', m + interval '2 minutes',  '1.0', 10, '14', 'found'),
    (t, 'd2', 'paycraft_paywall_view',      'paywall',      'ios',     'live', m + interval '5 seconds',  '1.0', 10, '17.1', NULL),
    (t, 'd2', 'paycraft_paywall_view',      'paywall',      'ios',     'live', m + interval '20 seconds', '1.0', 10, '17.1', NULL),
    (t, 'd3', 'paycraft_sign_in_view',      'sign_in',      'android', 'live', m,                         '1.0', 10, '14', NULL),
    (t, 'd3', 'paycraft_sign_in_fail',      'sign_in',      'android', 'live', m + interval '1 minute',   '1.0', 10, '14', 'network'),
    (t, 'd4', 'paycraft_paywall_view',      'paywall',      'android', 'live', m + interval '3 minutes',  '2.0', 20, '15', NULL),
    (t, 'd4', 'paycraft_restore_result',    'restore',      'android', 'live', m + interval '4 minutes',  '2.0', 20, '15', 'not_found'),
    (t, 'd5', 'paycraft_paywall_view',      'paywall',      'android', 'live', m + interval '3 minutes',  '2.0', 20, '15', NULL),
    (t, 'd5', 'paycraft_purchase_success',  'checkout',     'android', 'live', m + interval '4 minutes',  '2.0', 20, '15', NULL),
    (t, 'd5', 'paycraft_sign_in_complete',  'sign_in',      'android', 'live', m + interval '4 minutes',  '2.0', 20, '15', NULL),
    (t, 'd6', 'paycraft_device_limit_view', 'device_limit', 'android', 'live', m + interval '5 minutes',  '2.0', 20, '15', NULL),
    (t, 'd6', 'paycraft_device_transfer',   'device_limit', 'android', 'live', m + interval '6 minutes',  '2.0', 20, '15', 'done'),
    (t, 'd8', 'paycraft_paywall_view',      'paywall',      'android', 'live', m + interval '6 minutes',  '2.0', 20, '15', NULL),
    (t, 'd7', 'paycraft_paywall_view',      'paywall',      'web',     'live', m + interval '7 minutes',  NULL,  NULL, NULL, NULL),
    (t, 'dT', 'paycraft_paywall_view',      'paywall',      'android', 'test', m,                         '1.0', 10, '14', NULL),
    (t, 'dO', 'paycraft_paywall_view',      'paywall',      'android', 'live', now() - interval '3 days', '1.0', 10, '14', NULL),
    (other, 'x1', 'paycraft_paywall_view',  'paywall',      'android', 'live', m,                         '1.0', 10, '14', NULL);

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 4. version compare (service role)
  SELECT * INTO r FROM public.paywall_version_compare(t, now() - interval '1 hour', 'live') WHERE app_version = '1.0';
  IF r.devices <> 3 OR r.paywall_views <> 2 OR r.purchases <> 1 OR r.purchase_rate <> 0.5
     OR r.sign_in_views <> 1 OR r.sign_in_completes <> 0 OR r.sign_in_fails <> 1
     OR r.restores_found <> 1 OR r.restores_not_found <> 0 OR r.device_limit_views <> 0 OR r.device_transfers <> 0
     OR r.first_seen <> m OR r.last_seen <> m + interval '2 minutes' THEN
    RAISE EXCEPTION 'FAIL 4a: 1.0 row %', r; END IF;
  SELECT * INTO r FROM public.paywall_version_compare(t, now() - interval '1 hour', 'live') WHERE app_version = '2.0';
  IF r.devices <> 4 OR r.paywall_views <> 3 OR r.purchases <> 1 OR r.purchase_rate <> 0.3333
     OR r.sign_in_views <> 0 OR r.sign_in_completes <> 1 OR r.sign_in_fails <> 0
     OR r.restores_found <> 0 OR r.restores_not_found <> 1 OR r.device_limit_views <> 1 OR r.device_transfers <> 1 THEN
    RAISE EXCEPTION 'FAIL 4b: 2.0 row %', r; END IF;
  SELECT * INTO r FROM public.paywall_version_compare(t, now() - interval '1 hour', 'live') WHERE app_version = 'unknown';
  IF r.devices <> 1 OR r.paywall_views <> 1 OR r.purchases <> 0 OR r.purchase_rate <> 0 THEN
    RAISE EXCEPTION 'FAIL 4c: unknown row %', r; END IF;
  SELECT count(*) INTO n FROM public.paywall_version_compare(t, now() - interval '1 hour', 'live');
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 4d: expected 3 versions (1.0, 2.0, unknown), got %', n; END IF;
  SELECT app_version INTO r FROM public.paywall_version_compare(t, now() - interval '1 hour', 'live') LIMIT 1;
  IF r.app_version <> 'unknown' THEN RAISE EXCEPTION 'FAIL 4e: newest (first seen) version not first: %', r; END IF;
  SELECT count(*) INTO n FROM public.paywall_version_compare(t, now() - interval '1 hour', 'test');
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4f: test mode should see only its own row, got % versions', n; END IF;
  RAISE NOTICE 'ok 4 - paywall_version_compare: per-version distinct devices, rates, null as unknown, mode + window';

  -- 5. live minutes: d2's two views in one minute = 2 events, 1 device; d1 + d2 share 1.0's first minute
  SELECT * INTO r FROM public.paywall_live_minutes(t, now() - interval '1 hour', 'live')
   WHERE minute = m AND name = 'paycraft_paywall_view' AND app_version = '1.0';
  IF r.events <> 3 OR r.devices <> 2 THEN RAISE EXCEPTION 'FAIL 5a: first-minute views %', r; END IF;
  SELECT * INTO r FROM public.paywall_live_minutes(t, now() - interval '1 hour', 'live') WHERE app_version = 'unknown';
  IF r.minute <> m + interval '7 minutes' OR r.events <> 1 OR r.devices <> 1 THEN RAISE EXCEPTION 'FAIL 5b: unknown %', r; END IF;
  SELECT sum(events) INTO n FROM public.paywall_live_minutes(t, now() - interval '1 hour', 'live');
  IF n <> 16 THEN RAISE EXCEPTION 'FAIL 5c: expected 16 in-window live events, got %', n; END IF;
  RAISE NOTICE 'ok 5 - paywall_live_minutes: per-minute events + distinct devices';

  -- 6. a tenant admin may call both RPCs for their own tenant
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM public.paywall_version_compare(t, now() - interval '1 hour', 'live');
  IF n <> 3 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 6a: member got % versions', n; END IF;
  SELECT count(*) INTO n FROM public.paywall_live_minutes(t, now() - interval '1 hour', 'live');
  IF n = 0 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 6b: member got no minutes'; END IF;
  -- 7. …and RLS shows them their own rows only (what Realtime delivers)
  SELECT count(*) INTO n FROM paywall_events WHERE tenant_id = other;
  IF n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 7a: another tenant''s rows leaked through RLS (%)', n; END IF;
  SELECT count(*) INTO n FROM paywall_events WHERE tenant_id = t;
  IF n <> 18 THEN RESET ROLE; RAISE EXCEPTION 'FAIL 7b: member saw % of their 18 rows', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok 6 - a member calls both RPCs for their tenant';
  RAISE NOTICE 'ok 7 - RLS: a member SELECTs only their tenant''s rows';

  -- 8. an admin of ANOTHER tenant can neither call the RPCs for t nor read t's rows
  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM * FROM public.paywall_version_compare(t, now() - interval '1 hour', 'live');
    RESET ROLE;
    RAISE EXCEPTION 'FAIL 8a: a non-member called paywall_version_compare';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM * FROM public.paywall_live_minutes(t, now() - interval '1 hour', 'live');
    RESET ROLE;
    RAISE EXCEPTION 'FAIL 8b: a non-member called paywall_live_minutes';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT count(*) INTO n FROM paywall_events WHERE tenant_id = t;
  RESET ROLE;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 8c: a non-member read % of t''s rows', n; END IF;
  RAISE NOTICE 'ok 8 - a non-member cannot call the RPCs or read the rows';

  -- 9. anon: no EXECUTE on the RPCs, no rows
  -- (Checked by privilege, not by calling: an anon call refused for EXECUTE inside a plpgsql exception block
  --  segfaulted the local Supabase Postgres backend on 2026-11-28.)
  IF has_function_privilege('anon', 'public.paywall_version_compare(uuid, timestamptz, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.paywall_live_minutes(uuid, timestamptz, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 9a: anon holds EXECUTE on a Live RPC'; END IF;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n FROM paywall_events;
    RESET ROLE;
    IF n <> 0 THEN RAISE EXCEPTION 'FAIL 9b: anon read % rows', n; END IF;
  EXCEPTION WHEN insufficient_privilege THEN RESET ROLE; END;
  RAISE NOTICE 'ok 9 - anon denied';

  RAISE NOTICE 'PASS 223_paywall_events_release_dims: 9/9 groups ok';
END $$;
ROLLBACK;
