-- Assertions for migration 182 (email unique per APP, not globally; has_active_subscription).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/182_subscriptions_email_per_app_test.sql
BEGIN;
DO $$
DECLARE a UUID; b UUID; ka TEXT; kb TEXT; kal TEXT; dup BOOLEAN := false;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('app-a-182','a182@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_test, api_key_live INTO a, ka, kal;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('app-b-182','b182@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_test INTO b, kb;

  -- 1. The same buyer can subscribe in two different apps.
  INSERT INTO subscriptions (tenant_id, email, provider, provider_subscription_id, plan, status, mode, current_period_end)
  VALUES (a, 'same@buyer.test', 'stripe', 'sub_a_182', 'p', 'active', 'test', now() + interval '30 days'),
         (b, 'same@buyer.test', 'stripe', 'sub_b_182', 'p', 'active', 'test', now() + interval '30 days');

  -- 2. ...but not twice in the same app.
  BEGIN
    INSERT INTO subscriptions (tenant_id, email, provider, provider_subscription_id, plan, status, mode)
    VALUES (a, 'same@buyer.test', 'stripe', 'sub_a2_182', 'p', 'active', 'test');
  EXCEPTION WHEN unique_violation THEN dup := true;
  END;
  IF NOT dup THEN RAISE EXCEPTION 'FAIL: second row for the same (app, email) was accepted'; END IF;

  -- 3. has_active_subscription answers per app + mode, case-insensitively.
  IF has_active_subscription('Same@Buyer.test', ka) IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: active sub not found'; END IF;
  IF has_active_subscription('other@buyer.test', ka) IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: unknown email reported subscribed'; END IF;
  IF has_active_subscription('same@buyer.test', kal) IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: test-mode sub blocks a live purchase'; END IF;
  UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE provider_subscription_id = 'sub_b_182';
  IF has_active_subscription('same@buyer.test', kb) IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: expired sub reported active'; END IF;

  RAISE NOTICE 'ALL 6 assertions passed';
END $$;
ROLLBACK;
