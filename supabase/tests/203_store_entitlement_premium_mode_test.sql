-- Assertions for migration 203 (store entitlements count only in the device's own mode).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/203_store_entitlement_premium_mode_test.sql
BEGIN;
DO $$
DECLARE t UUID; kl TEXT; kt TEXT; live_tok TEXT; test_tok TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, max_active_devices)
  VALUES ('mode-203', 'm203@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w', 5)
  RETURNING id, api_key_live, api_key_test INTO t, kl, kt;

  live_tok := register_device('buyer@x.test', 'web', 'Live tab', 'dev-live', 'live', kl)->>'server_token';
  test_tok := register_device('buyer@x.test', 'web', 'Test tab', 'dev-test', 'test', kt)->>'server_token';

  -- 1. A SANDBOX store trial (the 2026-11-17 case): premium on the test device only, never on the live one.
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, is_sandbox, latest_event_ts)
  VALUES ('buyer@x.test', t, 'razorpay', 'pro-annual', 'sbx-1', 'trial', true, now());
  IF (check_premium_with_device(live_tok, kl)->>'is_premium')::boolean THEN RAISE EXCEPTION 'FAIL: sandbox entitlement made a LIVE device premium'; END IF;
  IF is_premium(live_tok, kl) THEN RAISE EXCEPTION 'FAIL: is_premium — sandbox entitlement on a live device'; END IF;
  IF NOT (check_premium_with_device(test_tok, kt)->>'is_premium')::boolean THEN RAISE EXCEPTION 'FAIL: sandbox entitlement must still make the TEST device premium'; END IF;

  -- 2. A REAL store purchase: premium on the live device, not on the test one.
  DELETE FROM entitlement_records WHERE tenant_id = t;
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, is_sandbox, latest_event_ts)
  VALUES ('buyer@x.test', t, 'google_play', 'pro-monthly', 'real-1', 'active', false, now());
  IF NOT (check_premium_with_device(live_tok, kl)->>'is_premium')::boolean THEN RAISE EXCEPTION 'FAIL: a real entitlement must make the LIVE device premium'; END IF;
  IF NOT is_premium(live_tok, kl) THEN RAISE EXCEPTION 'FAIL: is_premium — real entitlement on a live device'; END IF;
  IF (check_premium_with_device(test_tok, kt)->>'is_premium')::boolean THEN RAISE EXCEPTION 'FAIL: a real entitlement made a TEST device premium'; END IF;

  -- 3. The SDK (anon) can still call both; the helper is not exposed.
  IF NOT has_function_privilege('anon', 'public.check_premium_with_device(text,text)', 'execute') THEN RAISE EXCEPTION 'FAIL: anon lost check_premium_with_device'; END IF;
  IF has_function_privilege('anon', 'public._store_entitlement_premium_in_mode(uuid,text,text)', 'execute') THEN RAISE EXCEPTION 'FAIL: helper must not be callable by anon'; END IF;
  RAISE NOTICE 'ALL 9 assertions passed';
END $$;
ROLLBACK;
