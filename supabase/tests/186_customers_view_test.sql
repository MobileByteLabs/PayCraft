-- Assertions for migration 186 (one customer list: web subscriptions + store buyers + attempts).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/186_customers_view_test.sql
BEGIN;
DO $$
DECLARE t UUID; other UUID; u UUID := gen_random_uuid(); n INT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('cust-186','c186@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('other-186','o186@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO other;

  INSERT INTO subscriptions (tenant_id, email, provider, provider_subscription_id, plan, status, mode)
  VALUES (t, 'web@buyer.test', 'stripe', 'sub_186', 'pro-monthly', 'active', 'live');
  -- One Play buyer with two purchase tokens (expired, then renewed): must be ONE row, the newest state.
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, is_sandbox, latest_event_ts)
  VALUES ('play@buyer.test', t, 'google_play', 'premium', 'tok-1', 'expired', false, now() - interval '2 days'),
         ('play@buyer.test', t, 'google_play', 'premium', 'tok-2', 'active',  false, now());
  -- Anonymous store buyer (device id) still listed.
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, is_sandbox, latest_event_ts)
  VALUES ('9be33ff4edf3fbe8', t, 'google_play', 'premium', 'tok-3', 'active', true, now());
  -- Web entitlement mirrors the subscription → must NOT be listed twice.
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, is_sandbox, latest_event_ts)
  VALUES ('web@buyer.test', t, 'stripe', 'pro-monthly', 'sub_186', 'active', false, now());
  -- Attempts: one abandoner (twice → one row), and one who abandoned then subscribed (→ hidden).
  INSERT INTO checkout_attempts (tenant_id, provider, mode, email, plan, outcome, provider_session_id, occurred_at)
  VALUES (t, 'stripe', 'live', 'gone@buyer.test', 'pro-monthly', 'abandoned', 'cs_1', now() - interval '1 day'),
         (t, 'stripe', 'live', 'Gone@Buyer.test', 'pro-annual', 'payment_failed', 'cs_2', now()),
         (t, 'stripe', 'live', 'web@buyer.test', 'pro-monthly', 'abandoned', 'cs_3', now()),
         (other, 'stripe', 'live', 'x@other.test', NULL, 'abandoned', 'cs_4', now());

  SELECT count(*) INTO n FROM tenant_customers_view WHERE tenant_id = t;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL: expected 4 rows (web, play, device, attempt), got %', n; END IF;
  IF (SELECT status FROM tenant_customers_view WHERE tenant_id = t AND email = 'play@buyer.test') <> 'active' THEN
    RAISE EXCEPTION 'FAIL: store buyer must show the NEWEST state'; END IF;
  IF (SELECT mode FROM tenant_customers_view WHERE tenant_id = t AND app_user_id = '9be33ff4edf3fbe8') <> 'test' THEN
    RAISE EXCEPTION 'FAIL: sandbox purchase must be test mode'; END IF;
  IF (SELECT status FROM tenant_customers_view WHERE tenant_id = t AND source = 'attempt') <> 'payment_failed' THEN
    RAISE EXCEPTION 'FAIL: attempt must show the latest outcome'; END IF;
  IF EXISTS (SELECT 1 FROM tenant_customers_view WHERE tenant_id = t AND source = 'attempt' AND email = 'web@buyer.test') THEN
    RAISE EXCEPTION 'FAIL: someone who subscribed must not also be listed as an abandoner'; END IF;

  -- RLS: a tenant admin sees their app only, store rows included (was zero rows before 186).
  INSERT INTO auth.users (id, email) VALUES (u, 'admin186@test.local');
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (t, u, 'owner');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM tenant_customers_view;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL: tenant admin should see exactly their 4 rows, saw %', n; END IF;
  SELECT count(*) INTO n FROM entitlement_records;
  IF n <> 4 THEN RAISE EXCEPTION 'FAIL: tenant admin must read their entitlements (saw %)', n; END IF;
  RESET ROLE;
  RAISE NOTICE 'ALL 7 assertions passed';
END $$;
ROLLBACK;
