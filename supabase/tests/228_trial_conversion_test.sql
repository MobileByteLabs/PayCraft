-- Assertions for migration 228: trial start / conversion stamps on every write, and trial → paid per experiment arm.
BEGIN;
DO $$
DECLARE
  t UUID; o UUID; r RECORD; started TIMESTAMPTZ;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t228','e228@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO t;

  -- 1. a record created in trial is stamped; leaving trial for paid stamps the conversion once
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, latest_event_ts)
  VALUES ('dev-a', t, 'google_play', 'pro-monthly', 'txn-a', 'trial', now());
  SELECT trial_started_at INTO started FROM entitlement_records WHERE stable_txn_id = 'txn-a';
  IF started IS NULL THEN RAISE EXCEPTION 'FAIL 1a: trial not stamped'; END IF;
  UPDATE entitlement_records SET canonical_state = 'active' WHERE stable_txn_id = 'txn-a';
  SELECT * INTO r FROM entitlement_records WHERE stable_txn_id = 'txn-a';
  IF r.trial_converted_at IS NULL OR r.trial_started_at <> started THEN RAISE EXCEPTION 'FAIL 1b: %', r; END IF;
  RAISE NOTICE 'ok 1 - trial start and conversion stamped';

  -- 2. a direct paid purchase is never a trial; a trial that expires never converts
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, latest_event_ts)
  VALUES ('dev-b', t, 'google_play', 'pro-monthly', 'txn-b', 'active', now()),
         ('buyer@x.test', t, 'google_play', 'pro-monthly', 'txn-c', 'trial', now());
  UPDATE entitlement_records SET canonical_state = 'expired' WHERE stable_txn_id = 'txn-c';
  IF (SELECT trial_started_at FROM entitlement_records WHERE stable_txn_id = 'txn-b') IS NOT NULL
     OR (SELECT trial_converted_at FROM entitlement_records WHERE stable_txn_id = 'txn-c') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 2'; END IF;
  RAISE NOTICE 'ok 2 - paid-first is no trial; an expired trial is not a conversion';

  -- 3. results: arm "b" has 3 buyers — dev-a (trial→paid, by device), the email account (trial, expired), dev-b (paid)
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name, is_current) VALUES (t, 'c', 'C', true) RETURNING id INTO o;
  INSERT INTO paywall_experiments (tenant_id, key, name, variants, status, started_at)
  VALUES (t, 'trial', '', jsonb_build_array(jsonb_build_object('key','a','weight',50,'offering_id',o),
                                            jsonb_build_object('key','b','weight',50,'offering_id',o)), 'running', now() - interval '1 hour');
  INSERT INTO paywall_events (tenant_id, device_ref, user_ref, name, step, platform, mode, occurred_at, experiment, variant) VALUES
    (t, 'dev-a', NULL, 'paycraft_purchase_success', 'checkout', 'android', 'live', now(), 'trial', 'b'),
    (t, 'dev-c', encode(sha256(convert_to(t::text || ':buyer@x.test', 'UTF8')), 'hex'),
       'paycraft_purchase_success', 'checkout', 'android', 'live', now(), 'trial', 'b'),
    (t, 'dev-b', NULL, 'paycraft_purchase_success', 'checkout', 'android', 'live', now(), 'trial', 'b');
  SELECT * INTO r FROM paywall_experiment_results(t, 'trial') WHERE variant = 'b';
  IF r.buyers <> 3 OR r.trial_starts <> 2 OR r.trial_paid <> 1 THEN RAISE EXCEPTION 'FAIL 3: %', r; END IF;
  SELECT * INTO r FROM paywall_experiment_results(t, 'trial') WHERE variant = 'a';
  IF r.trial_starts <> 0 THEN RAISE EXCEPTION 'FAIL 3b: %', r; END IF;
  RAISE NOTICE 'ok 3 - trial → paid per arm, linked by device or account';
  RAISE NOTICE 'PASS 228_trial_conversion: 3/3 groups ok';
END $$;
ROLLBACK;
