-- Assertions for migration 210 (payment attempts: one record per attempt, from plan select through grant).
--
--   supabase start
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/210_payment_attempts_test.sql
--
-- Before 210 every assertion FAILS (the columns, tables and functions it probes do not exist); after it,
-- all eight groups pass. Runs in one transaction and rolls back, so it leaves nothing behind.
BEGIN;
DO $$
DECLARE
  t     UUID;
  other UUID;
  kl    TEXT;
  admin UUID := gen_random_uuid();
  aid   TEXT := 'att-' || gen_random_uuid();
  n     INT;
  s     TEXT;
BEGIN
  -- Free tier: tier_definitions.analytics_retention_days = 7 (the cap tier retention applies to attempts).
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, plan)
  VALUES ('e2e_210', 't210@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w', 'free')
  RETURNING id, api_key_live INTO t, kl;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('e2e_210_other', 'o210@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w')
  RETURNING id INTO other;

  -- 1. started → checkout_opened → provider_result → granted is the happy path, and every edge is allowed.
  --    A store lane (no server-side checkout page) may go started → provider_result directly.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, plan, outcome, provider_session_id,
                                 attempt_id, state, correlation)
  VALUES (t, 'stripe', 'live', 'u1', 'pro-monthly', 'abandoned', 'cs_test_210_1', aid, 'started', 'exact');
  UPDATE checkout_attempts SET state = 'checkout_opened' WHERE attempt_id = aid;
  UPDATE checkout_attempts SET state = 'provider_result', paid_at = now() WHERE attempt_id = aid;
  UPDATE checkout_attempts SET state = 'granted', granted_at = now(), closed_at = now() WHERE attempt_id = aid;
  IF (SELECT state FROM checkout_attempts WHERE attempt_id = aid) <> 'granted' THEN
    RAISE EXCEPTION 'FAIL 1: happy path did not reach granted'; END IF;
  -- One timeline row per state the attempt entered, written by the table itself (every writer, old or new).
  SELECT count(*) INTO n FROM attempt_events WHERE attempt_id = aid
    AND event IN ('started', 'checkout_opened', 'provider_result', 'granted');
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL 1: expected 4 transition rows on the timeline, got %', n; END IF;
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id,
                                 attempt_id, state, correlation)
  VALUES (t, 'google_play', 'live', 'u1', 'abandoned', 'att-play-210', 'att-play-210', 'started', 'exact');
  UPDATE checkout_attempts SET state = 'provider_result', paid_at = now() WHERE attempt_id = 'att-play-210';
  IF (SELECT state FROM checkout_attempts WHERE attempt_id = 'att-play-210') <> 'provider_result' THEN
    RAISE EXCEPTION 'FAIL 1: store lane started → provider_result refused'; END IF;

  -- 2. granted is terminal, and an edge the machine does not declare is refused (check_violation).
  BEGIN
    UPDATE checkout_attempts SET state = 'failed' WHERE attempt_id = aid;
    RAISE EXCEPTION 'FAIL 2: granted was mutated';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'attempt_terminal%' THEN RAISE EXCEPTION 'FAIL 2: wrong refusal: %', SQLERRM; END IF;
  END;
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id,
                                 attempt_id, state, correlation)
  VALUES (t, 'stripe', 'live', 'u3', 'abandoned', 'cs_test_210_skip', 'att-skip', 'started', 'exact');
  BEGIN
    UPDATE checkout_attempts SET state = 'granted' WHERE attempt_id = 'att-skip';
    RAISE EXCEPTION 'FAIL 2: started → granted (no provider result) accepted';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'attempt_illegal_transition%' THEN RAISE EXCEPTION 'FAIL 2: wrong refusal: %', SQLERRM; END IF;
  END;

  -- 3. abandoned → granted IS allowed (a late webhook after the abandon timeout) and keeps its timestamp.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, plan, outcome, provider_session_id,
                                 attempt_id, state, correlation)
  VALUES (t, 'stripe', 'live', 'u2', 'pro-monthly', 'abandoned', 'cs_test_210_2', 'att-late', 'abandoned', 'exact');
  UPDATE checkout_attempts SET state = 'granted', granted_at = now(), closed_at = now() WHERE attempt_id = 'att-late';
  IF (SELECT granted_at FROM checkout_attempts WHERE attempt_id = 'att-late') IS NULL THEN
    RAISE EXCEPTION 'FAIL 3: late granted lost its timestamp'; END IF;

  -- 4. correlation ∈ (exact, inferred); state ∈ the seven declared states.
  BEGIN
    INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id,
                                   attempt_id, state, correlation)
    VALUES (t, 'stripe', 'live', 'u', 'abandoned', 'cs_bad', 'att-bad', 'started', 'guessed');
    RAISE EXCEPTION 'FAIL 4: correlation accepted garbage';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id,
                                   attempt_id, state, correlation)
    VALUES (t, 'stripe', 'live', 'u', 'abandoned', 'cs_bad2', 'att-bad2', 'pending', 'exact');
    RAISE EXCEPTION 'FAIL 4: state accepted garbage';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 5. An error_message over 200 chars, or a stage outside the five, is rejected (D6: bounded, groupable).
  BEGIN
    INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_message)
    VALUES (aid, t, 'provider', 'declined', repeat('x', 400));
    RAISE EXCEPTION 'FAIL 5: oversize error_message accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO attempt_events (attempt_id, tenant_id, stage, event) VALUES (aid, t, 'ui', 'declined');
    RAISE EXCEPTION 'FAIL 5: unknown stage accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  -- A failure recorded on the row reaches the timeline with its stage, class, code and message.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id,
                                 attempt_id, state)
  VALUES (t, 'razorpay', 'live', 'u5', 'abandoned', 'att-fail-210', 'att-fail-210', 'checkout_opened');
  UPDATE checkout_attempts SET state = 'failed', outcome = 'payment_failed', stage = 'provider',
         error_class = 'card_declined', error_code = 'do_not_honor', error_message = 'issuer declined'
    WHERE attempt_id = 'att-fail-210';
  IF NOT EXISTS (SELECT 1 FROM attempt_events WHERE attempt_id = 'att-fail-210' AND event = 'failed'
                 AND stage = 'provider' AND error_class = 'card_declined' AND error_code = 'do_not_honor'
                 AND error_message = 'issuer declined') THEN
    RAISE EXCEPTION 'FAIL 5: the failure did not reach the timeline with its stage / class / code / message'; END IF;
  BEGIN
    UPDATE checkout_attempts SET error_message = repeat('y', 201) WHERE attempt_id = 'att-fail-210';
    RAISE EXCEPTION 'FAIL 5: oversize error_message accepted on the attempt row';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 6. attempt_events is append-only, and RLS shows a tenant admin their app's attempts + timeline only.
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event) VALUES (aid, t, 'sdk', 'plan_select');
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event) VALUES ('att-other', other, 'sdk', 'plan_select');
  SELECT count(*) INTO n FROM attempt_events WHERE attempt_id = aid;
  IF n < 1 THEN RAISE EXCEPTION 'FAIL 6: append did not land'; END IF;
  BEGIN
    UPDATE attempt_events SET event = 'rewritten' WHERE attempt_id = aid;
    RAISE EXCEPTION 'FAIL 6: a timeline row was rewritten';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'attempt_events_append_only%' THEN RAISE EXCEPTION 'FAIL 6: wrong refusal: %', SQLERRM; END IF;
  END;
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id,
                                 attempt_id, state, correlation)
  VALUES (other, 'stripe', 'live', 'x', 'abandoned', 'cs_other_210', 'att-other', 'started', 'exact');
  INSERT INTO auth.users (id, email) VALUES (admin, 'admin210@test.local');
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (t, admin, 'owner');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  IF EXISTS (SELECT 1 FROM attempt_events WHERE tenant_id = other) THEN
    RAISE EXCEPTION 'FAIL 6: another app''s timeline leaked through RLS'; END IF;
  IF EXISTS (SELECT 1 FROM payment_attempts WHERE tenant_id = other) THEN
    RAISE EXCEPTION 'FAIL 6: another app''s attempt leaked through payment_attempts'; END IF;
  IF NOT EXISTS (SELECT 1 FROM payment_attempts WHERE attempt_id = aid AND state = 'granted') THEN
    RAISE EXCEPTION 'FAIL 6: the admin cannot read their own attempt'; END IF;
  BEGIN
    INSERT INTO attempt_events (attempt_id, tenant_id, stage, event) VALUES (aid, t, 'sdk', 'forged');
    RAISE EXCEPTION 'FAIL 6: an authenticated user wrote the timeline';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;

  -- 7. Tier retention purges closed attempts + timeline past the tier cap (free = 7 days), keeps the rest;
  --    the stitcher's clock is a parameter: paid with no grant for > 10 min → paid_not_granted, an opened
  --    checkout silent for > 120 min → abandoned.
  UPDATE checkout_attempts SET occurred_at = now() - interval '90 days', closed_at = now() - interval '90 days'
    WHERE attempt_id = 'att-late';
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, occurred_at)
  VALUES ('att-late', t, 'sdk', 'plan_select', now() - interval '90 days');
  PERFORM tier_retention_purge_attempts();
  IF EXISTS (SELECT 1 FROM checkout_attempts WHERE attempt_id = 'att-late') THEN
    RAISE EXCEPTION 'FAIL 7: old row not purged'; END IF;
  IF EXISTS (SELECT 1 FROM attempt_events WHERE tenant_id = t AND occurred_at < now() - interval '8 days') THEN
    RAISE EXCEPTION 'FAIL 7: old timeline not purged'; END IF;
  IF NOT EXISTS (SELECT 1 FROM checkout_attempts WHERE attempt_id = aid) THEN
    RAISE EXCEPTION 'FAIL 7: a fresh attempt was purged'; END IF;

  UPDATE checkout_attempts SET paid_at = '2026-11-25T00:00:00Z' WHERE attempt_id = 'att-play-210';
  UPDATE checkout_attempts SET state = 'checkout_opened', occurred_at = '2026-11-25T00:00:00Z'
    WHERE attempt_id = 'att-skip';
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id,
                                 attempt_id, state, occurred_at)
  VALUES (t, 'app_store', 'live', 'u7', 'abandoned', 'att-started-210', 'att-started-210', 'started',
          '2026-11-25T00:00:00Z');
  PERFORM attempt_stitch_run('2026-11-25T00:09:59Z'::timestamptz, 10, 120);
  IF (SELECT state FROM checkout_attempts WHERE attempt_id = 'att-play-210') <> 'provider_result' THEN
    RAISE EXCEPTION 'FAIL 7: paid_not_granted fired before the 10-minute cutoff'; END IF;
  PERFORM attempt_stitch_run('2026-11-25T00:10:01Z'::timestamptz, 10, 120);
  IF (SELECT state FROM checkout_attempts WHERE attempt_id = 'att-play-210') <> 'paid_not_granted' THEN
    RAISE EXCEPTION 'FAIL 7: paid_not_granted did not fire after the 10-minute cutoff'; END IF;
  IF NOT EXISTS (SELECT 1 FROM attempt_events WHERE attempt_id = 'att-play-210' AND event = 'paid_not_granted'
                 AND stage = 'entitlement') THEN
    RAISE EXCEPTION 'FAIL 7: paid_not_granted left no timeline row'; END IF;
  IF (SELECT state FROM checkout_attempts WHERE attempt_id = 'att-skip') <> 'checkout_opened' THEN
    RAISE EXCEPTION 'FAIL 7: an opened checkout was abandoned before the 120-minute timeout'; END IF;
  PERFORM attempt_stitch_run('2026-11-25T02:00:01Z'::timestamptz, 10, 120);
  SELECT state INTO s FROM checkout_attempts WHERE attempt_id = 'att-skip';
  IF s <> 'abandoned' THEN RAISE EXCEPTION 'FAIL 7: silent checkout not abandoned (state=%)', s; END IF;
  IF (SELECT state FROM checkout_attempts WHERE attempt_id = 'att-started-210') <> 'abandoned' THEN
    RAISE EXCEPTION 'FAIL 7: an attempt that never progressed past started was not timed out'; END IF;
  IF NOT EXISTS (SELECT 1 FROM attempt_events WHERE attempt_id = 'att-skip' AND event = 'abandoned'
                 AND error_class = 'abandon_timeout') THEN
    RAISE EXCEPTION 'FAIL 7: the abandon timeout left no timeline row'; END IF;
  IF (SELECT state FROM checkout_attempts WHERE attempt_id = aid) <> 'granted' THEN
    RAISE EXCEPTION 'FAIL 7: the stitcher touched a granted attempt'; END IF;

  -- 8. 186 / 188 / 201 writers still work unchanged (no attempt_id, no state), and their rows land in the
  --    terminal state their outcome already says — never an open attempt nobody will close.
  PERFORM record_store_attempt(kl, 'legacy-user', 'google_play', 'premium_monthly', 'abandoned', 'legacy-att-1', 'connect_3');
  IF (SELECT failure_reason FROM checkout_attempts WHERE provider_session_id = 'legacy-att-1') <> 'connect_3' THEN
    RAISE EXCEPTION 'FAIL 8: 201 writer broke'; END IF;
  IF (SELECT state FROM checkout_attempts WHERE provider_session_id = 'legacy-att-1') <> 'abandoned'
     OR (SELECT closed_at FROM checkout_attempts WHERE provider_session_id = 'legacy-att-1') IS NULL THEN
    RAISE EXCEPTION 'FAIL 8: a legacy abandoned row is not closed as abandoned'; END IF;
  INSERT INTO checkout_attempts (tenant_id, provider, mode, email, plan, outcome, provider_session_id)
  VALUES (t, 'stripe', 'live', 'web@x.test', 'pro', 'payment_failed', 'cs_legacy_210');
  IF (SELECT state FROM checkout_attempts WHERE provider_session_id = 'cs_legacy_210') <> 'failed'
     OR (SELECT correlation FROM checkout_attempts WHERE provider_session_id = 'cs_legacy_210') IS NOT NULL
     OR (SELECT attempt_id FROM checkout_attempts WHERE provider_session_id = 'cs_legacy_210') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 8: a 186 webhook row must land closed as failed, uncorrelated (the stitcher owns it)'; END IF;
  -- The customer list still means "tried and did not finish": a finished failure is listed with its old
  -- status vocabulary, an attempt still in flight is not.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, email, outcome, provider_session_id, attempt_id, state)
  VALUES (t, 'stripe', 'live', 'inflight@x.test', 'abandoned', 'cs_inflight_210', 'att-inflight-210', 'checkout_opened');
  IF EXISTS (SELECT 1 FROM tenant_customers_view WHERE tenant_id = t AND email = 'inflight@x.test') THEN
    RAISE EXCEPTION 'FAIL 8: an attempt still in checkout is listed as a customer who did not finish'; END IF;
  IF (SELECT status FROM tenant_customers_view WHERE tenant_id = t AND email = 'web@x.test') <> 'payment_failed' THEN
    RAISE EXCEPTION 'FAIL 8: a failed attempt lost its payment_failed status in the customer list'; END IF;
  IF (SELECT correlation FROM checkout_attempts WHERE attempt_id = aid) <> 'exact' THEN
    RAISE EXCEPTION 'FAIL 8: a row opened with an attempt_id must default to correlation=exact'; END IF;

  RAISE NOTICE 'ALL 8 assertions passed';
END $$;
ROLLBACK;
