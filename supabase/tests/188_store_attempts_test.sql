-- Assertions for migration 188 (store purchase attempts reported by the SDK).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/188_store_attempts_test.sql
BEGIN;
DO $$
DECLARE t UUID; k TEXT; kl TEXT; n INT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('store-attempts-188','s188@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_test, api_key_live INTO t, k, kl;

  -- 1. An anonymous device that closed the Play sheet is recorded, keyed by its app user id.
  IF record_store_attempt(kl, '9be33ff4edf3fbe8', 'google_play', 'premium_monthly', 'abandoned', 'att-1') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: attempt not recorded'; END IF;
  IF (SELECT status FROM tenant_customers_view WHERE tenant_id = t AND app_user_id = '9be33ff4edf3fbe8') <> 'abandoned' THEN
    RAISE EXCEPTION 'FAIL: device attempt not listed'; END IF;
  IF (SELECT mode FROM tenant_customers_view WHERE tenant_id = t AND app_user_id = '9be33ff4edf3fbe8') <> 'live' THEN
    RAISE EXCEPTION 'FAIL: live key must record a live attempt'; END IF;

  -- 2. The same report twice (SDK retry) is one row.
  PERFORM record_store_attempt(kl, '9be33ff4edf3fbe8', 'google_play', 'premium_monthly', 'abandoned', 'att-1');
  IF (SELECT count(*) FROM checkout_attempts WHERE tenant_id = t) <> 1 THEN RAISE EXCEPTION 'FAIL: retry duplicated'; END IF;

  -- 3. A signed-in buyer's failure carries the email; once they buy in the store, the attempt drops off.
  PERFORM record_store_attempt(kl, 'Buyer@X.test', 'app_store', 'premium', 'payment_failed', 'att-2');
  IF (SELECT email FROM checkout_attempts WHERE provider_session_id = 'att-2') <> 'buyer@x.test' THEN
    RAISE EXCEPTION 'FAIL: email-shaped app user id must fill email'; END IF;
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state, is_sandbox, latest_event_ts)
  VALUES ('buyer@x.test', t, 'app_store', 'premium', 'otx-1', 'active', false, now());
  IF EXISTS (SELECT 1 FROM tenant_customers_view WHERE tenant_id = t AND source = 'attempt' AND email = 'buyer@x.test') THEN
    RAISE EXCEPTION 'FAIL: a buyer who then purchased must not stay listed as an attempt'; END IF;

  -- 4. Garbage is refused, and an unknown key raises (resolve_tenant) rather than writing anywhere.
  IF record_store_attempt(kl, 'u', 'stripe', 'p', 'abandoned', 'att-3') IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: web provider accepted'; END IF;
  IF record_store_attempt(kl, 'u', 'google_play', 'p', 'refunded', 'att-4') IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: bad outcome accepted'; END IF;
  IF record_store_attempt(kl, '', 'google_play', 'p', 'abandoned', 'att-5') IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: no identity accepted'; END IF;
  BEGIN
    PERFORM record_store_attempt('pk_live_nope', 'u', 'google_play', 'p', 'abandoned', 'att-6');
    RAISE EXCEPTION 'FAIL: unknown key accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
  END;
  IF NOT has_function_privilege('anon', 'public.record_store_attempt(text,text,text,text,text,text)', 'execute') THEN
    RAISE EXCEPTION 'FAIL: the SDK (anon) must be able to report'; END IF;

  -- 5. Stripe-style attempts (email only) still work.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, email, plan, outcome, provider_session_id)
  VALUES (t, 'stripe', 'live', 'web@x.test', 'pro', 'abandoned', 'cs_188');
  SELECT count(*) INTO n FROM tenant_customers_view WHERE tenant_id = t AND source = 'attempt';
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 attempt rows (device + web), got %', n; END IF;
  RAISE NOTICE 'ALL 10 assertions passed';
END $$;
ROLLBACK;
