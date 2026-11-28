-- Assertions for migration 224: the Telegram channel (encrypted, write-only), the three new alert kinds and
-- their toggles, and the rule aggregates on seeded paywall_events. Needs 223 (app_version / app_build).
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/224_release_alerts_telegram_test.sql
BEGIN;
-- encrypt_provider_key refuses the dev-default passphrase; a throwaway one, rolled back with the rest (211's way).
UPDATE public.paycraft_secrets_config SET passphrase = 'test-224-' || gen_random_uuid()::text;
DO $$
DECLARE
  t      UUID;
  t2     UUID;
  q      UUID;
  token  CONSTANT TEXT := '123456789:AAH-telegram_secret_token_abcdefghijk';
  now_   CONSTANT TIMESTAMPTZ := '2026-11-28T10:00:00Z';
  st     RECORD;
  d      RECORD;
  r      RECORD;
  n      INT;
  ok     BOOLEAN;
  raw    TEXT;
  i      INT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('Reels 224', 'o224@x.test', 'pk_test_224', 'pk_live_224', 'whsec_t224', 'whsec_l224') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('Quiet 224', 'q224@x.test', 'pk_test_224q', 'pk_live_224q', 'whsec_t224q', 'whsec_l224q') RETURNING id INTO q;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  -- 1. columns + pair CHECK
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'tenant_alert_channels' AND column_name IN ('telegram_bot_token_enc', 'telegram_chat_id');
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 1: telegram columns missing (%)', n; END IF;
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'tenant_alert_prefs' AND column_name IN ('release_regression', 'sign_in_failing', 'paywall_silent')
     AND column_default = 'true';
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 1: prefs toggles missing or not default ON (%)', n; END IF;
  RAISE NOTICE 'ok 1 - columns and default-on toggles';

  -- 2. save → status reports configured, never the token; stored encrypted; decrypt round-trips
  PERFORM tenant_alert_channels_save(t, NULL, NULL, NULL, NULL, NULL, token, '-1001234567890');
  SELECT * INTO st FROM tenant_alert_channels_status(t);
  IF st.telegram_configured IS NOT TRUE THEN RAISE EXCEPTION 'FAIL 2: telegram_configured = %', st.telegram_configured; END IF;
  IF row_to_json(st)::TEXT LIKE '%telegram_secret_token%' OR row_to_json(st)::TEXT LIKE '%-1001234567890%' THEN
    RAISE EXCEPTION 'FAIL 2: status leaked a Telegram value';
  END IF;
  SELECT encode(telegram_bot_token_enc, 'escape') INTO raw FROM tenant_alert_channels WHERE tenant_id = t;
  IF raw LIKE '%telegram_secret_token%' THEN RAISE EXCEPTION 'FAIL 2: token stored in plaintext'; END IF;
  SELECT * INTO d FROM tenant_alert_channels_decrypt(t);
  IF d.telegram_bot_token IS DISTINCT FROM token OR d.telegram_chat_id IS DISTINCT FROM '-1001234567890' THEN
    RAISE EXCEPTION 'FAIL 2: decrypt round-trip % / %', d.telegram_bot_token IS NOT NULL, d.telegram_chat_id;
  END IF;
  RAISE NOTICE 'ok 2 - token encrypted, status boolean-only, decrypt round-trips';

  -- 3. NULL keeps, chat id alone re-points, '' clears both; other channels untouched
  PERFORM tenant_alert_channels_save(t, NULL, NULL, NULL, NULL, NULL, NULL, '@paycraft_ops');
  SELECT * INTO d FROM tenant_alert_channels_decrypt(t);
  IF d.telegram_bot_token IS DISTINCT FROM token OR d.telegram_chat_id <> '@paycraft_ops' THEN RAISE EXCEPTION 'FAIL 3: re-point'; END IF;
  PERFORM tenant_alert_channels_save(t, FALSE, NULL, NULL, NULL, NULL);   -- 211's 6-arg call shape still works
  SELECT * INTO d FROM tenant_alert_channels_decrypt(t);
  IF d.telegram_bot_token IS NULL OR d.email_enabled THEN RAISE EXCEPTION 'FAIL 3: 6-arg save lost telegram or ignored email'; END IF;
  PERFORM tenant_alert_channels_save(t, NULL, NULL, NULL, NULL, NULL, '', NULL);
  SELECT * INTO st FROM tenant_alert_channels_status(t);
  SELECT * INTO d FROM tenant_alert_channels_decrypt(t);
  IF st.telegram_configured OR d.telegram_bot_token IS NOT NULL OR d.telegram_chat_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL 3: clear'; END IF;
  RAISE NOTICE 'ok 3 - keep / re-point / clear';

  -- 4. validation
  FOREACH raw IN ARRAY ARRAY['bad-token|-1', token || '|not a chat', token || '|', '|-100'] LOOP
    ok := FALSE;
    BEGIN
      PERFORM tenant_alert_channels_save(t, NULL, NULL, NULL, NULL, NULL,
        NULLIF(split_part(raw, '|', 1), ''), NULLIF(split_part(raw, '|', 2), ''));
    EXCEPTION WHEN invalid_parameter_value THEN ok := TRUE;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'FAIL 4: accepted %', raw; END IF;
  END LOOP;
  RAISE NOTICE 'ok 4 - invalid token / chat id / token without chat id / chat id without token refused';

  -- 5. decrypt + rules stay service-role only; status refuses a stranger
  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  FOREACH raw IN ARRAY ARRAY['decrypt', 'release', 'signin', 'silent', 'status'] LOOP
    ok := FALSE;
    BEGIN
      CASE raw
        WHEN 'decrypt' THEN PERFORM * FROM tenant_alert_channels_decrypt(t);
        WHEN 'release' THEN PERFORM * FROM analytics_alert_release_regression(now_);
        WHEN 'signin'  THEN PERFORM * FROM analytics_alert_sign_in_failing(now_);
        WHEN 'silent'  THEN PERFORM * FROM analytics_alert_paywall_silent(now_);
        ELSE PERFORM * FROM tenant_alert_channels_status(t);
      END CASE;
    EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
    END;
    IF NOT ok THEN RAISE EXCEPTION 'FAIL 5: % reachable by a non-service caller', raw; END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  RAISE NOTICE 'ok 5 - service-role only';

  -- 6. kinds accepted, telegram ledger channel accepted, toggle honoured
  t2 := tenant_alert_record(t, 'release_regression', 'critical', '3.1.0', 'Release 3.1.0 regressed', 'x', '{}'::jsonb, NULL, NULL, NULL, NULL, now_);
  IF t2 IS NULL THEN RAISE EXCEPTION 'FAIL 6: release_regression not recorded'; END IF;
  PERFORM alert_delivery_record(t2, 'telegram', TRUE, 200, NULL, now_);
  IF NOT EXISTS (SELECT 1 FROM alert_deliveries WHERE alert_id = t2 AND channel = 'telegram' AND status = 'sent') THEN
    RAISE EXCEPTION 'FAIL 6: telegram delivery not recorded';
  END IF;
  IF tenant_alert_record(t, 'release_regression', 'critical', '3.1.0', 'again', 'x', '{}'::jsonb, NULL, NULL, NULL, NULL, now_ + interval '1 hour') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 6: 24 h dedupe on app_version';
  END IF;
  INSERT INTO tenant_alert_prefs (tenant_id, paywall_silent) VALUES (t, FALSE)
    ON CONFLICT (tenant_id) DO UPDATE SET paywall_silent = FALSE;
  IF tenant_alert_record(t, 'paywall_silent', 'critical', 'hour-2026-11-28T10', 'silent', 'x', '{}'::jsonb, NULL, NULL, NULL, NULL, now_) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 6: paywall_silent toggle ignored';
  END IF;
  IF tenant_alert_record(t, 'sign_in_failing', 'critical', 'hour-2026-11-28T10', 'signin', 'x', '{}'::jsonb, NULL, NULL, NULL, NULL, now_) IS NULL THEN
    RAISE EXCEPTION 'FAIL 6: sign_in_failing not recorded';
  END IF;
  RAISE NOTICE 'ok 6 - new kinds, telegram ledger, dedupe, toggle';

  -- 7. release_regression aggregate. 3.0.9 (build 39): 100 view devices, 15 buy. 3.1.0 (build 40): 40 view
  -- devices, 4 buy, 3 sign-in fails / 7 ok. Test-mode noise on 3.1.0 must not count.
  FOR i IN 1..100 LOOP
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, app_build)
    VALUES (t, 'old-' || i, 'paycraft_paywall_view', 'paywall', 'android', 'live', now_ - interval '3 days', '3.0.9', 39);
  END LOOP;
  FOR i IN 1..15 LOOP
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, app_build)
    VALUES (t, 'old-' || i, 'paycraft_purchase_success', 'purchase', 'android', 'live', now_ - interval '3 days', '3.0.9', 39);
  END LOOP;
  FOR i IN 1..40 LOOP
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, app_build)
    VALUES (t, 'new-' || i, 'paycraft_paywall_view', 'paywall', 'android', 'live', now_ - interval '1 hour', '3.1.0', 40);
  END LOOP;
  FOR i IN 1..4 LOOP
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, app_build)
    VALUES (t, 'new-' || i, 'paycraft_purchase_success', 'purchase', 'android', 'live', now_ - interval '1 hour', '3.1.0', 40);
  END LOOP;
  FOR i IN 1..10 LOOP
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, app_build, provider)
    VALUES (t, 'new-' || i, CASE WHEN i <= 3 THEN 'paycraft_sign_in_fail' ELSE 'paycraft_sign_in_complete' END, 'sign_in', 'android',
            'live', now_ - interval '10 minutes', '3.1.0', 40, 'google');
  END LOOP;
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, app_build)
  SELECT t, 'testmode-' || g, 'paycraft_paywall_view', 'paywall', 'android', 'test', now_ - interval '1 hour', '3.2.0', 41
    FROM generate_series(1, 50) g;

  SELECT * INTO r FROM analytics_alert_release_regression(now_) WHERE tenant_id = t;
  IF r.app_version IS DISTINCT FROM '3.1.0' OR r.previous_version IS DISTINCT FROM '3.0.9'
     OR r.paywall_view_devices <> 40 OR r.purchase_devices <> 4 OR r.purchase_rate <> 0.1
     OR r.prev_paywall_view_devices <> 100 OR r.prev_purchase_rate <> 0.15
     OR r.sign_in_fails <> 3 OR r.sign_in_completes <> 7 OR r.sign_in_fail_share <> 0.3 OR r.prev_sign_in_fail_share IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 7: release row %', row_to_json(r);
  END IF;
  SELECT count(*) INTO n FROM analytics_alert_release_regression(now_, 7, 41) WHERE tenant_id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 7: newest under the device floor still returned'; END IF;
  RAISE NOTICE 'ok 7 - release_regression: newest vs previous, live only, device floor';

  -- 8. sign_in_failing aggregate: 3 fails < 5 → none; add 3 more → 6 fails / 7 ok
  SELECT count(*) INTO n FROM analytics_alert_sign_in_failing(now_) WHERE tenant_id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 8: 3 failures returned'; END IF;
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, app_version, provider)
  SELECT t, 'f-' || g, 'paycraft_sign_in_fail', 'sign_in', 'ios', 'live', now_ - interval '5 minutes', '3.1.0', 'apple'
    FROM generate_series(1, 3) g;
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, provider)   -- outside the window
  SELECT t, 'old-f-' || g, 'paycraft_sign_in_fail', 'sign_in', 'ios', 'live', now_ - interval '61 minutes', 'apple'
    FROM generate_series(1, 5) g;
  SELECT * INTO r FROM analytics_alert_sign_in_failing(now_) WHERE tenant_id = t;
  IF r.sign_in_fails <> 6 OR r.sign_in_completes <> 7 OR r.sign_in_fail_share <> 0.4615
     OR r.fails_by_provider <> '{"apple": 3, "google": 3}'::jsonb THEN
    RAISE EXCEPTION 'FAIL 8: sign-in row %', row_to_json(r);
  END IF;
  RAISE NOTICE 'ok 8 - sign_in_failing: 60-min window, floor, share, by provider';

  -- 9. paywall_silent: q had 5 views in this hour on each of the 7 previous days and none now → returned with 0;
  -- the mean drops under 5 when one day goes quiet; a view now is counted.
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at)
  SELECT q, 'q-' || dd || '-' || g, 'paycraft_paywall_view', 'paywall', 'android', 'live',
         now_ - make_interval(days => dd) - interval '30 minutes'
    FROM generate_series(1, 7) dd, generate_series(1, 5) g;
  SELECT * INTO r FROM analytics_alert_paywall_silent(now_) WHERE tenant_id = q;
  IF r.paywall_views IS DISTINCT FROM 0 OR r.baseline_mean <> 5 THEN RAISE EXCEPTION 'FAIL 9: silent row %', row_to_json(r); END IF;
  DELETE FROM paywall_events WHERE tenant_id = q AND occurred_at > now_ - interval '2 days' - interval '1 hour'
                                  AND occurred_at <= now_ - interval '2 days';
  SELECT count(*) INTO n FROM analytics_alert_paywall_silent(now_) WHERE tenant_id = q;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 9: mean 30/7 < 5 still returned'; END IF;
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at)
  SELECT q, 'q2-' || g, 'paycraft_paywall_view', 'paywall', 'android', 'live', now_ - interval '2 days' - interval '10 minutes'
    FROM generate_series(1, 5) g;
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at)
  VALUES (q, 'q-now', 'paycraft_paywall_view', 'paywall', 'android', 'live', now_ - interval '2 minutes');
  SELECT * INTO r FROM analytics_alert_paywall_silent(now_) WHERE tenant_id = q;
  IF r.paywall_views IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'FAIL 9: current views %', row_to_json(r); END IF;
  RAISE NOTICE 'ok 9 - paywall_silent: same-hour 7-day mean, current window';

  RAISE NOTICE 'PASS 224_release_alerts_telegram: 9/9 groups ok';
END $$;
ROLLBACK;
