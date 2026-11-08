-- Assertions for migration 177 (check_premium_with_device returns the token's bound email).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/177_premium_check_returns_bound_email_test.sql
BEGIN;
DO $$
DECLARE v_key TEXT; tok TEXT; r JSONB;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('bound-email-177','t177@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING api_key_test INTO v_key;
  tok := (register_device('Old.User@Test.local', 'android', 'Pixel', 'dev-177', 'test', v_key))->>'server_token';
  r := check_premium_with_device(tok, v_key);
  IF r->>'email' IS DISTINCT FROM 'old.user@test.local' THEN RAISE EXCEPTION 'FAIL bound email: %', r; END IF;
  IF (r->>'token_valid')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL token_valid: %', r; END IF;
  r := check_premium_with_device('no-such-token', v_key);
  IF r ? 'email' THEN RAISE EXCEPTION 'FAIL invalid token leaks email: %', r; END IF;
  RAISE NOTICE 'ALL 3 assertions passed';
END $$;
ROLLBACK;
