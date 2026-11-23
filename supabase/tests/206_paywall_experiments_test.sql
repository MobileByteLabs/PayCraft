-- Assertions for migration 206 (paywall A/B experiments: save rules, one running per tenant, results per variant).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/206_paywall_experiments_test.sql
BEGIN;
DO $$
DECLARE
  t UUID; o1 UUID; o2 UUID; r RECORD; started TIMESTAMPTZ;
  good JSONB;
  expect_error TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('exp-206','e206@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id INTO t;
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name, is_current) VALUES (t, 'control', 'Control', true) RETURNING id INTO o1;
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name) VALUES (t, 'cheaper', 'Cheaper') RETURNING id INTO o2;
  good := jsonb_build_array(
    jsonb_build_object('key', 'control', 'weight', 50, 'offering_id', o1),
    jsonb_build_object('key', 'cheaper', 'weight', 50, 'offering_id', o2));

  -- 1. Every save rule refuses with its code.
  FOR r IN SELECT * FROM (VALUES
    ('Bad Key',  good, 'experiment_key_invalid'),
    ('price-test', jsonb_build_array(good->0), 'experiment_variants_count'),
    ('price-test', jsonb_build_array(good->0, jsonb_set(good->1, '{key}', '"Bad Key"')), 'experiment_variant_key_invalid'),
    ('price-test', jsonb_build_array(good->0, good->0), 'experiment_variant_key_duplicate'),
    ('price-test', jsonb_build_array(good->0, jsonb_set(good->1, '{weight}', '0')), 'experiment_weight_invalid'),
    ('price-test', jsonb_build_array(good->0, jsonb_set(good->1, '{weight}', '12.5')), 'experiment_weight_invalid'),
    ('price-test', jsonb_build_array(good->0, jsonb_set(good->1, '{offering_id}', to_jsonb(gen_random_uuid()::text))), 'experiment_offering_unknown')
  ) AS c(k, v, code) LOOP
    expect_error := NULL;
    BEGIN
      PERFORM paywall_experiment_save(t, r.k, '', r.v);
    EXCEPTION WHEN OTHERS THEN expect_error := SQLERRM;
    END;
    IF expect_error IS DISTINCT FROM r.code THEN RAISE EXCEPTION 'FAIL: expected %, got %', r.code, expect_error; END IF;
  END LOOP;

  -- 2. A valid draft saves and stays editable; the SDK sees nothing until it runs.
  PERFORM paywall_experiment_save(t, 'price-test', 'Price test', good);
  PERFORM paywall_experiment_save(t, 'price-test', 'Price test v2', good);
  IF paywall_experiment_public_get(t) IS NOT NULL THEN RAISE EXCEPTION 'FAIL: draft served to the SDK'; END IF;

  -- 3. Running: served to the SDK, frozen, and the only running one.
  PERFORM paywall_experiment_set_status(t, 'price-test', 'running');
  IF paywall_experiment_public_get(t)->>'key' <> 'price-test'
     OR jsonb_array_length(paywall_experiment_public_get(t)->'variants') <> 2 THEN
    RAISE EXCEPTION 'FAIL: running experiment not served: %', paywall_experiment_public_get(t);
  END IF;
  BEGIN
    PERFORM paywall_experiment_save(t, 'price-test', '', good);
    RAISE EXCEPTION 'FAIL: running experiment edited';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'experiment_not_editable' THEN RAISE; END IF;
  END;
  PERFORM paywall_experiment_save(t, 'second', '', good);
  BEGIN
    PERFORM paywall_experiment_set_status(t, 'second', 'running');
    RAISE EXCEPTION 'FAIL: two running experiments';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'experiment_already_running' THEN RAISE; END IF;
  END;

  -- 4. Results count each device once per step, live mode only, per variant, in variant order.
  SELECT started_at INTO started FROM paywall_experiments WHERE tenant_id = t AND key = 'price-test';
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, experiment, variant) VALUES
    (t, 'd1', 'paycraft_paywall_view',     'paywall',  'android', 'live', started + interval '1 min', 'price-test', 'control'),
    (t, 'd1', 'paycraft_paywall_view',     'paywall',  'android', 'live', started + interval '2 min', 'price-test', 'control'),
    (t, 'd2', 'paycraft_paywall_view',     'paywall',  'android', 'live', started + interval '1 min', 'price-test', 'control'),
    (t, 'd3', 'paycraft_paywall_view',     'paywall',  'ios',     'live', started + interval '1 min', 'price-test', 'cheaper'),
    (t, 'd3', 'paycraft_checkout_start',   'checkout', 'ios',     'live', started + interval '2 min', 'price-test', 'cheaper'),
    (t, 'd3', 'paycraft_purchase_success', 'checkout', 'ios',     'live', started + interval '3 min', 'price-test', 'cheaper'),
    (t, 'd4', 'paycraft_purchase_success', 'checkout', 'ios',     'test', started + interval '3 min', 'price-test', 'cheaper'),
    (t, 'd5', 'paycraft_paywall_view',     'paywall',  'ios',     'live', started - interval '1 day', 'price-test', 'cheaper');
  SELECT * INTO r FROM paywall_experiment_results(t, 'price-test') LIMIT 1;
  IF r.variant <> 'control' OR r.viewers <> 2 OR r.buyers <> 0 OR r.conversion <> 0 THEN RAISE EXCEPTION 'FAIL: control %', r; END IF;
  SELECT * INTO r FROM paywall_experiment_results(t, 'price-test') OFFSET 1;
  IF r.variant <> 'cheaper' OR r.viewers <> 1 OR r.checkouts <> 1 OR r.buyers <> 1 OR r.conversion <> 1 THEN
    RAISE EXCEPTION 'FAIL: cheaper %', r;
  END IF;

  -- 5. Stopped is final.
  PERFORM paywall_experiment_set_status(t, 'price-test', 'stopped');
  IF paywall_experiment_public_get(t) IS NOT NULL THEN RAISE EXCEPTION 'FAIL: stopped experiment still served'; END IF;
  BEGIN
    PERFORM paywall_experiment_set_status(t, 'price-test', 'running');
    RAISE EXCEPTION 'FAIL: stopped experiment restarted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'experiment_bad_transition' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS 206 paywall experiments';
END $$;
ROLLBACK;
