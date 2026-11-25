-- Assertions for migration 211 (owner alerts: channels, stored alerts, delivery ledger, rule aggregates, cron).
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/211_attempt_alerts_test.sql
--
-- Fourteen numbered groups; each RAISEs 'FAIL n: …' on the first broken expectation and prints 'ok n - …' when
-- it holds. Before 211 every group fails (the tables and functions it probes do not exist). Runs in one
-- transaction and rolls back, so it leaves nothing behind.
BEGIN;
-- encrypt_provider_key refuses the dev-default passphrase; a throwaway one, rolled back with the rest (191's way).
UPDATE public.paycraft_secrets_config SET passphrase = 'test-211-' || gen_random_uuid()::text;
DO $$
DECLARE
  t       UUID;
  other   UUID;
  admin   UUID := gen_random_uuid();
  now0    TIMESTAMPTZ := '2026-11-25T10:20:00Z';
  a1      UUID;
  a2      UUID;
  r       RECORD;
  n       INT;
  s       TEXT;
  ok      BOOLEAN;
  service CONSTANT TEXT := '{"role":"service_role"}';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, plan)
  VALUES ('e2e_211', 'owner211@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w', 'free')
  RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('e2e_211_other', 'other211@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w')
  RETURNING id INTO other;
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (t, admin, 'owner');

  -- 1. Tables exist; the Slack and webhook URLs are stored as encrypted bytea, never text.
  IF to_regclass('public.tenant_alert_channels') IS NULL OR to_regclass('public.tenant_alerts') IS NULL
     OR to_regclass('public.alert_deliveries') IS NULL THEN
    RAISE EXCEPTION 'FAIL 1: an alert table is missing'; END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenant_alert_channels'
     AND column_name IN ('slack_url_enc', 'webhook_url_enc', 'webhook_secret_enc') AND data_type = 'bytea';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 1: channel secrets are not all bytea (% of 3)', n; END IF;
  RAISE NOTICE 'ok 1 - tables exist; slack/webhook url + secret are encrypted bytea';

  -- 2. CHECK: a webhook URL without its secret (half-configured) is rejected by the table.
  BEGIN
    INSERT INTO tenant_alert_channels (tenant_id, webhook_url_enc, webhook_secret_enc)
    VALUES (t, encrypt_provider_key('https://x.test/hook'), NULL);
    RAISE EXCEPTION 'FAIL 2: half-configured webhook accepted';
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS s = CONSTRAINT_NAME;
    IF s <> 'tenant_alert_channels_webhook_pair' THEN RAISE EXCEPTION 'FAIL 2: wrong constraint %', s; END IF;
  END;
  RAISE NOTICE 'ok 2 - half-configured webhook rejected by tenant_alert_channels_webhook_pair';

  -- 3. tenant_alert_channels_save: admins only; https only for an admin; NULL keeps, '' clears; a new webhook
  --    URL needs a secret; the secret rotates alone; '' clears URL and secret together.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM tenant_alert_channels_save(t, TRUE, 'https://hooks.slack.test/a', NULL, NULL, TRUE);
    RAISE EXCEPTION 'FAIL 3: a non-admin saved channels';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM tenant_alert_channels_save(t, TRUE, 'http://hooks.slack.test/a', NULL, NULL, TRUE);
    RAISE EXCEPTION 'FAIL 3: an admin saved a plain-http Slack URL';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS s = MESSAGE_TEXT;
    IF s <> 'slack_url_invalid' THEN RAISE EXCEPTION 'FAIL 3: %', s; END IF;
  END;
  PERFORM tenant_alert_channels_save(t, TRUE, 'https://hooks.slack.test/a', NULL, NULL, TRUE);
  PERFORM tenant_alert_channels_save(t, FALSE, NULL, NULL, NULL, TRUE);
  IF (SELECT slack_url_enc FROM tenant_alert_channels WHERE tenant_id = t) IS NULL THEN
    RAISE EXCEPTION 'FAIL 3: NULL slack_url did not KEEP the stored value'; END IF;
  IF (SELECT email_enabled FROM tenant_alert_channels WHERE tenant_id = t) THEN
    RAISE EXCEPTION 'FAIL 3: email toggle not saved'; END IF;
  PERFORM tenant_alert_channels_save(t, TRUE, '', NULL, NULL, TRUE);
  IF (SELECT slack_url_enc FROM tenant_alert_channels WHERE tenant_id = t) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 3: empty-string slack_url did not CLEAR the stored value'; END IF;
  BEGIN
    PERFORM tenant_alert_channels_save(t, TRUE, NULL, 'https://hooks.owner.test/pc', NULL, TRUE);
    RAISE EXCEPTION 'FAIL 3: webhook URL saved without a secret';
  EXCEPTION WHEN invalid_parameter_value THEN
    GET STACKED DIAGNOSTICS s = MESSAGE_TEXT;
    IF s <> 'webhook_secret_required' THEN RAISE EXCEPTION 'FAIL 3: %', s; END IF;
  END;
  PERFORM tenant_alert_channels_save(t, TRUE, 'https://hooks.slack.test/b', 'https://hooks.owner.test/pc', 'first-secret-0123456789', TRUE);
  PERFORM tenant_alert_channels_save(t, TRUE, NULL, NULL, 'second-secret-0123456789', TRUE);
  RAISE NOTICE 'ok 3 - tenant_alert_channels_save: admin-only, https-only, NULL keeps, empty clears, secret required + rotatable';

  -- 4. Status never returns a secret; the admin sees configured flags only.
  SELECT * INTO r FROM tenant_alert_channels_status(t);
  IF NOT (r.email_enabled AND r.slack_configured AND r.webhook_configured AND r.inbox_enabled) THEN
    RAISE EXCEPTION 'FAIL 4: status flags wrong: %', r; END IF;
  SELECT count(*) INTO n FROM information_schema.routines rt
    JOIN information_schema.parameters p ON p.specific_name = rt.specific_name
   WHERE rt.routine_name = 'tenant_alert_channels_status' AND p.parameter_mode = 'OUT'
     AND (p.parameter_name LIKE '%url' OR p.parameter_name LIKE '%secret');
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 4: status exposes % secret column(s)', n; END IF;
  BEGIN
    PERFORM * FROM tenant_alert_channels_status(other);
    RAISE EXCEPTION 'FAIL 4: admin read another tenant''s channel status';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok 4 - status shows flags only, never a URL or secret, and only for the admin''s own tenant';

  -- 5. Decrypt is the service role's alone; it round-trips the plaintext and defaults an unsaved tenant.
  BEGIN
    PERFORM * FROM tenant_alert_channels_decrypt(t);
    RAISE EXCEPTION 'FAIL 5: decrypt answered an authenticated caller';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS s = MESSAGE_TEXT;
    IF s <> 'forbidden' THEN RAISE EXCEPTION 'FAIL 5: %', s; END IF;
  END;
  PERFORM set_config('request.jwt.claims', service, true);
  SELECT * INTO r FROM tenant_alert_channels_decrypt(t);
  IF r.slack_url IS DISTINCT FROM 'https://hooks.slack.test/b' OR r.webhook_url IS DISTINCT FROM 'https://hooks.owner.test/pc'
     OR r.webhook_secret IS DISTINCT FROM 'second-secret-0123456789' OR r.owner_email <> 'owner211@test.local' THEN
    RAISE EXCEPTION 'FAIL 5: decrypt round-trip wrong (rotation must keep the URL and replace the secret)'; END IF;
  SELECT * INTO r FROM tenant_alert_channels_decrypt(other);
  IF NOT (r.email_enabled AND r.inbox_enabled) OR r.slack_url IS NOT NULL OR r.webhook_url IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5: an unsaved tenant must default to email + inbox only: %', r; END IF;
  -- '' clears URL and secret together (the pair CHECK holds).
  PERFORM tenant_alert_channels_save(t, TRUE, NULL, '', NULL, TRUE);
  SELECT * INTO r FROM tenant_alert_channels_decrypt(t);
  IF r.webhook_url IS NOT NULL OR r.webhook_secret IS NOT NULL THEN RAISE EXCEPTION 'FAIL 5: webhook not cleared'; END IF;
  RAISE NOTICE 'ok 5 - decrypt refuses non-service-role callers ("forbidden"), round-trips, defaults, clears';

  -- 6. tenant_alerts dedupe: the same (tenant, kind, dedupe_key) within 24 h is refused by the table itself.
  INSERT INTO tenant_alerts (tenant_id, kind, severity, dedupe_key, title) VALUES (t, 'paid_not_granted', 'critical', 'att-x', 'x');
  BEGIN
    INSERT INTO tenant_alerts (tenant_id, kind, severity, dedupe_key, title) VALUES (t, 'paid_not_granted', 'critical', 'att-x', 'x');
    RAISE EXCEPTION 'FAIL 6: second alert within 24 h accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS s = MESSAGE_TEXT;
    IF s NOT LIKE 'tenant_alerts_dedupe_24h:%' THEN RAISE EXCEPTION 'FAIL 6: %', s; END IF;
  END;
  -- Another tenant, kind or key is not a duplicate.
  INSERT INTO tenant_alerts (tenant_id, kind, severity, dedupe_key, title) VALUES (other, 'paid_not_granted', 'critical', 'att-x', 'x');
  INSERT INTO tenant_alerts (tenant_id, kind, severity, dedupe_key, title) VALUES (t, 'webhook_sig_fail', 'critical', 'att-x', 'x');
  RAISE NOTICE 'ok 6 - second alert within 24 h deduped by tenant_alerts_dedupe_24h; other tenant/kind unaffected';

  -- 7. tenant_alert_record: NULL on a repeat inside 24 h, a new id after it (a rolling window, not a day).
  a1 := tenant_alert_record(t, 'abandon_digest', 'digest', 'hour-2026-11-25T09', '7 abandoned', 'b', '{"count":7}', NULL, NULL, NULL, NULL, '2026-11-25T23:50:00Z');
  IF a1 IS NULL THEN RAISE EXCEPTION 'FAIL 7: first record returned NULL'; END IF;
  IF tenant_alert_record(t, 'abandon_digest', 'digest', 'hour-2026-11-25T09', '7 abandoned', 'b', '{}', NULL, NULL, NULL, NULL, '2026-11-26T00:10:00Z') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 7: a repeat 20 minutes later (across midnight) was not deduped'; END IF;
  IF tenant_alert_record(t, 'abandon_digest', 'digest', 'hour-2026-11-25T09', '7 abandoned', 'b', '{}', NULL, NULL, NULL, NULL, '2026-11-27T00:00:00Z') IS NULL THEN
    RAISE EXCEPTION 'FAIL 7: a repeat after 24 h was refused'; END IF;
  RAISE NOTICE 'ok 7 - tenant_alert_record dedupes on a rolling 24 h window';

  -- 8. The tenant's per-kind toggle (tenant_alert_prefs, 025 + 211) turns a kind off.
  UPDATE tenant_alert_prefs SET paid_not_granted = FALSE WHERE tenant_id = t;
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL 8: tenant has no prefs row (025 trigger)'; END IF;
  IF tenant_alert_record(t, 'paid_not_granted', 'critical', 'att-off', 'x', 'b') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 8: a disabled kind was recorded'; END IF;
  IF tenant_alert_record(t, 'failure_rate_spike', 'critical', 'sdk', 'x', 'b') IS NULL THEN
    RAISE EXCEPTION 'FAIL 8: an enabled kind was not recorded'; END IF;
  UPDATE tenant_alert_prefs SET paid_not_granted = TRUE WHERE tenant_id = t;
  RAISE NOTICE 'ok 8 - per-kind toggle off suppresses that kind only';

  -- 9. alert_deliveries: UNIQUE (alert_id, channel) — one row per channel per alert.
  INSERT INTO alert_deliveries (alert_id, channel, status) VALUES (a1, 'slack', 'pending');
  BEGIN
    INSERT INTO alert_deliveries (alert_id, channel, status) VALUES (a1, 'slack', 'pending');
    RAISE EXCEPTION 'FAIL 9: duplicate (alert, channel) accepted';
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS s = CONSTRAINT_NAME;
    IF s <> 'alert_deliveries_once_per_channel' THEN RAISE EXCEPTION 'FAIL 9: wrong constraint %', s; END IF;
  END;
  DELETE FROM alert_deliveries WHERE alert_id = a1;
  RAISE NOTICE 'ok 9 - alert_deliveries UNIQUE (alert_id, channel) holds';

  -- 10. alert_delivery_record backoff: 2, 4, 8, 16, 30 (cap) minutes; after 8 attempts no further retry; a
  --     sent delivery is final.
  FOR i IN 1..8 LOOP
    SELECT * INTO r FROM alert_delivery_record(a1, 'webhook', FALSE, 500, 'HTTP 500: boom', now0);
    IF r.attempts <> i THEN RAISE EXCEPTION 'FAIL 10: attempts % after % failures', r.attempts, i; END IF;
    IF i < 8 AND r.next_retry_at <> now0 + make_interval(mins => least((2 ^ i)::INT, 30)) THEN
      RAISE EXCEPTION 'FAIL 10: next_retry_at % after % failures', r.next_retry_at, i; END IF;
    IF i = 8 AND r.next_retry_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL 10: retried past 8 attempts'; END IF;
  END LOOP;
  SELECT * INTO r FROM alert_delivery_record(a1, 'email', TRUE, NULL, NULL, now0);
  IF r.status <> 'sent' OR r.attempts <> 1 OR r.next_retry_at IS NOT NULL THEN RAISE EXCEPTION 'FAIL 10: first send %', r; END IF;
  SELECT count(*) INTO n FROM alert_delivery_record(a1, 'email', FALSE, 500, 'late failure', now0);
  IF n <> 0 OR (SELECT status FROM alert_deliveries WHERE alert_id = a1 AND channel = 'email') <> 'sent' THEN
    RAISE EXCEPTION 'FAIL 10: a sent delivery was rewritten'; END IF;
  RAISE NOTICE 'ok 10 - ledger backoff min(2^attempts, 30) min, stops at 8 attempts, sent is final';

  -- 11. alert_deliveries_due returns only failed rows whose retry has come.
  PERFORM alert_delivery_record(a1, 'slack', FALSE, NULL, 'timeout', now0);           -- due at now0 + 2 min
  SELECT count(*) INTO n FROM alert_deliveries_due(now0 + interval '1 minute') d WHERE d.alert_id = a1;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 11: % row(s) due before next_retry_at', n; END IF;
  SELECT count(*) INTO n FROM alert_deliveries_due(now0 + interval '3 minutes') d WHERE d.alert_id = a1;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 11: expected the slack row due (webhook exhausted, email sent), got %', n; END IF;
  RAISE NOTICE 'ok 11 - alert_deliveries_due: failed + due only (never sent, never exhausted)';

  -- 12. Rule aggregates over 210's rows, on the injected clock.
  --   paid_not_granted: provider paid 15 min ago, never granted → flagged by the stitcher → listed.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, plan, outcome, provider_session_id, attempt_id,
                                 state, correlation, paid_at, occurred_at)
  VALUES (t, 'stripe', 'live', 'u1', 'pro-monthly', 'abandoned', 'cs_211_png', 'att-211-png', 'provider_result', 'exact',
          now0 - interval '15 minutes', now0 - interval '20 minutes');
  PERFORM attempt_stitch_run(now0, 10, 120);
  SELECT count(*) INTO n FROM attempt_alert_paid_not_granted(now0) WHERE tenant_id = t AND attempt_id = 'att-211-png';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 12: paid_not_granted not listed (%)', n; END IF;
  --   webhook failures: signature refusals grouped per provider code; processing failures per class.
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, error_code, occurred_at) VALUES
    ('att-w1', t, 'webhook', 'signature_failed', 'signature', 'stripe_signature', now0 - interval '5 minutes'),
    ('att-w2', t, 'webhook', 'signature_failed', 'signature', 'stripe_signature', now0 - interval '4 minutes'),
    ('att-w3', t, 'webhook', 'signature_failed', 'signature', 'razorpay_signature', now0 - interval '3 minutes'),
    ('att-w4', t, 'webhook', 'failed', 'stripe_webhook', 'db_error', now0 - interval '2 minutes'),
    ('att-w5', t, 'webhook', 'signature_failed', 'signature', 'stripe_signature', now0 - interval '2 hours');
  SELECT string_agg(kind || ':' || group_key || ':' || failures, ',' ORDER BY kind, group_key) INTO s
    FROM attempt_alert_webhook_failures(now0, 60) WHERE tenant_id = t;
  IF s IS DISTINCT FROM 'webhook_proc_fail:stripe_webhook:1,webhook_sig_fail:razorpay_signature:1,webhook_sig_fail:stripe_signature:2' THEN
    RAISE EXCEPTION 'FAIL 12: webhook failure groups %', s; END IF;
  RAISE NOTICE 'ok 12 - paid_not_granted + webhook signature/processing aggregates';

  -- 13. Failure-rate spike (D9): 1 failure/h for 7 days at stage provider = baseline 1/h; 4 in the last hour
  --     does not fire (< 5), the 5th does (>= 5 and >= 3x). Abandons never count as failures.
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, occurred_at)
  SELECT 'att-base-' || h, other, 'provider', 'failed', 'card_declined', now0 - make_interval(hours => h) - interval '30 minutes'
    FROM generate_series(1, 168) h;
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, occurred_at)
  SELECT 'att-cur-' || i, other, 'provider', 'failed', 'card_declined', now0 - make_interval(mins => i)
    FROM generate_series(1, 4) i;
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, occurred_at)
  SELECT 'att-abn-' || i, other, 'provider', 'abandoned', 'abandon_timeout', now0 - make_interval(mins => i)
    FROM generate_series(1, 9) i;
  SELECT count(*) INTO n FROM attempt_failure_spikes_current_hour(now0) WHERE tenant_id = other;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 13: 4 failures (abandons excluded) fired a spike'; END IF;
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, occurred_at)
  VALUES ('att-cur-5', other, 'provider', 'failed', 'card_declined', now0 - interval '30 seconds');
  SELECT * INTO r FROM attempt_failure_spikes_current_hour(now0) WHERE tenant_id = other;
  IF r.failures IS DISTINCT FROM 5 OR r.baseline_failures <> 168 OR r.baseline_rate_per_hour <> 1 OR r.stage <> 'provider' THEN
    RAISE EXCEPTION 'FAIL 13: spike row %', r; END IF;
  --   Hourly digest: the previous whole UTC hour only.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, plan, outcome, provider_session_id, attempt_id,
                                 state, error_code, closed_at, occurred_at)
  SELECT t, 'stripe', 'live', 'u-abn-' || i, 'pro-monthly', 'abandoned', 'cs_211_abn_' || i, 'att-211-abn-' || i, 'abandoned',
         'no_result_120m', '2026-11-25T09:00:00Z'::timestamptz + make_interval(mins => i * 7), now0 - interval '3 hours'
    FROM generate_series(0, 7) i;                                     -- 09:00 … 09:49 → 8 rows; i=0..7
  SELECT * INTO r FROM attempt_hourly_abandon_summary(now0) WHERE tenant_id = t;
  IF r.count <> 8 OR r.window_start <> '2026-11-25T09:00:00Z' OR r.window_end <> '2026-11-25T10:00:00Z'
     OR (r.by_provider ->> 'stripe')::INT <> 8 OR (r.top_codes ->> 'no_result_120m')::INT <> 8 THEN
    RAISE EXCEPTION 'FAIL 13: abandon digest %', r; END IF;
  SELECT count(*) INTO n FROM attempt_hourly_decline_summary(now0) WHERE tenant_id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 13: decline digest listed abandons'; END IF;
  RAISE NOTICE 'ok 13 - failure_rate_spike fires only at >= 5 and >= 3x baseline; hourly digest windows the previous hour';

  -- 14. The four schedules AC-8 needs (+ retention) are registered, and the phase-6 dispatcher stub is a no-op.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT count(*) INTO n FROM cron.job
     WHERE jobname IN ('paycraft_attempt_alerts_digest', 'paycraft_attempt_stitch', 'paycraft_tenant_alerts', 'paycraft_attempt_insights');
    IF n <> 4 THEN RAISE EXCEPTION 'FAIL 14: % of 4 cron schedules registered', n; END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'paycraft_attempt_stitch' AND schedule = '*/5 * * * *') THEN
      RAISE EXCEPTION 'FAIL 14: attempt-stitch is not every 5 minutes'; END IF;
  END IF;
  PERFORM attempt_insights_dispatch();
  -- Without the vault entries a schedule calls nothing (a laptop never reaches production).
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name IN ('paycraft_functions_url', 'paycraft_store_sync_url'))
     AND paycraft_function_post('attempt-alerts?mode=digest') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 14: paycraft_function_post called out without vault entries'; END IF;
  RAISE NOTICE 'ok 14 - 4 cron schedules registered; insights stub + function_post are safe no-ops locally';

  -- RLS: an admin reads only their tenant's alerts and may write read_at, nothing else.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM tenant_alerts WHERE tenant_id = other;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL RLS: admin sees % alert(s) of another tenant', n; END IF;
  SELECT count(*) INTO n FROM tenant_alerts WHERE tenant_id = t;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL RLS: admin cannot see own alerts'; END IF;
  UPDATE tenant_alerts SET read_at = now() WHERE id = a1;
  BEGIN
    UPDATE tenant_alerts SET title = 'tampered' WHERE id = a1;
    RAISE EXCEPTION 'FAIL RLS: admin rewrote an alert title';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM tenant_alert_channels;
    RAISE EXCEPTION 'FAIL RLS: authenticated read tenant_alert_channels directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('role', 'postgres', true);
  IF (SELECT read_at FROM tenant_alerts WHERE id = a1) IS NULL THEN RAISE EXCEPTION 'FAIL RLS: mark-read did not persist'; END IF;

  RAISE NOTICE 'PASS 211_attempt_alerts: 14/14 groups ok (+ RLS isolation)';
END $$;
ROLLBACK;
