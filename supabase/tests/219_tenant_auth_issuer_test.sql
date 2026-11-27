-- Assertions for migration 219: tenant_set_auth_issuer writes a bare https origin, refuses anything else,
-- clears on blank, and is service-role only.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/219_tenant_auth_issuer_test.sql
BEGIN;
DO $$
DECLARE
  t  UUID;
  v  TEXT;
  ok BOOLEAN;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('Issuer App', 'o219@x.test', 'pk_test_219', 'pk_live_219', 'whsec_t219', 'whsec_l219') RETURNING id INTO t;

  v := tenant_set_auth_issuer(t, ' https://abcdefghijklmnopqrst.supabase.co/ ');
  IF v <> 'https://abcdefghijklmnopqrst.supabase.co' THEN RAISE EXCEPTION 'FAIL 1: returned %', v; END IF;
  SELECT auth_issuer_url INTO v FROM tenants WHERE id = t;
  IF v <> 'https://abcdefghijklmnopqrst.supabase.co' THEN RAISE EXCEPTION 'FAIL 1: stored %', v; END IF;
  IF (SELECT auth_issuer_set_at FROM tenants WHERE id = t) IS NULL THEN RAISE EXCEPTION 'FAIL 1: set_at not stamped'; END IF;
  RAISE NOTICE 'ok 1 - trims, drops the trailing slash, stamps set_at';

  ok := FALSE;
  BEGIN PERFORM tenant_set_auth_issuer(t, 'https://x.supabase.co/auth/v1');
  EXCEPTION WHEN invalid_parameter_value THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 2: accepted a path (identity-verify appends /auth/v1 itself)'; END IF;
  ok := FALSE;
  BEGIN PERFORM tenant_set_auth_issuer(t, 'http://x.supabase.co');
  EXCEPTION WHEN invalid_parameter_value THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 2: accepted plain http'; END IF;
  RAISE NOTICE 'ok 2 - refuses a path and plain http';

  PERFORM tenant_set_auth_issuer(t, '  ');
  SELECT auth_issuer_url INTO v FROM tenants WHERE id = t;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'FAIL 3: blank did not clear (%)', v; END IF;
  RAISE NOTICE 'ok 3 - blank clears';

  ok := FALSE;
  BEGIN PERFORM tenant_set_auth_issuer(gen_random_uuid(), 'https://x.supabase.co');
  EXCEPTION WHEN no_data_found THEN ok := TRUE; END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 4: an unknown tenant was silently ignored'; END IF;
  RAISE NOTICE 'ok 4 - unknown tenant raises';

  IF has_function_privilege('authenticated', 'public.tenant_set_auth_issuer(uuid, text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tenant_set_auth_issuer(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5: callable by a non-service role';
  END IF;
  RAISE NOTICE 'ok 5 - service role only';

  RAISE NOTICE 'PASS 219_tenant_auth_issuer: 5/5 groups ok';
END $$;
ROLLBACK;
