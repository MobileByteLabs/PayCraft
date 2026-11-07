-- Assertions for migration 174 (api_key_set_scopes — edit a pcsk_ key's scopes in place).
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/174_api_key_set_scopes_test.sql
--
-- Before 174 the function does not exist and every assertion FAILs; after 174 all pass.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant  UUID;
  v_tenant2 UUID;
  v_owner   UUID := gen_random_uuid();
  v_other   UUID := gen_random_uuid();
  v_admin   UUID := gen_random_uuid();
  v_viewer  UUID := gen_random_uuid();
  v_acct    UUID;
  v_app     UUID;
  v_dead    UUID;
  v_old     UUID;
  v_hash    TEXT;
  v_res     TEXT[];
  v_audit   INT;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner174@test.local'), (v_other, 'other174@test.local');

  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('scopes-174-a','a174@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING id INTO v_tenant;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('scopes-174-b','b174@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING id INTO v_tenant2;

  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES
    (v_tenant, v_owner, 'owner'), (v_tenant2, v_owner, 'admin'),
    (v_tenant, v_admin, 'admin'), (v_tenant, v_viewer, 'viewer'),
    (v_tenant2, v_other, 'owner');

  -- Fixture keys inserted directly (hash is arbitrary; no plaintext exists anywhere).
  INSERT INTO tenant_api_keys (tenant_id, owner_user_id, name, key_prefix, key_hash, scopes, expires_at)
  VALUES (NULL, v_owner, 'acct', 'pcsk_acct', md5(random()::text), ARRAY['readiness:read'], now() + interval '30 days')
  RETURNING id, key_hash INTO v_acct, v_hash;
  INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
  VALUES (v_tenant, 'app', 'pcsk_app', md5(random()::text), ARRAY['readiness:read']) RETURNING id INTO v_app;
  INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes, revoked_at)
  VALUES (v_tenant, 'revoked', 'pcsk_rev', md5(random()::text), ARRAY['readiness:read'], now()) RETURNING id INTO v_dead;
  INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes, expires_at)
  VALUES (v_tenant, 'expired', 'pcsk_exp', md5(random()::text), ARRAY['readiness:read'], now() - interval '1 day') RETURNING id INTO v_old;

  -- ── owner edits own account key: deduped + sorted, hash untouched, audited per reachable app ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  v_res := api_key_set_scopes(v_acct, ARRAY['onboarding:write','apps:write','onboarding:write','readiness:read']);
  INSERT INTO _t VALUES ('owner-updates-account-key',
    (SELECT scopes FROM tenant_api_keys WHERE id = v_acct) = ARRAY['apps:write','onboarding:write','readiness:read']);
  INSERT INTO _t VALUES ('returns-deduped-sorted', v_res = ARRAY['apps:write','onboarding:write','readiness:read']);
  INSERT INTO _t VALUES ('key-hash-unchanged', (SELECT key_hash FROM tenant_api_keys WHERE id = v_acct) = v_hash);
  SELECT count(*) INTO v_audit FROM tenant_audit_log
   WHERE action = 'api_key.scopes_updated' AND resource = 'tenant_api_keys:id=' || v_acct;
  INSERT INTO _t VALUES ('account-change-audited-in-each-reachable-app', v_audit = 2);

  -- ── another user cannot touch it (even one who administers an app the key reaches) ──────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  BEGIN
    PERFORM api_key_set_scopes(v_acct, ARRAY['readiness:read']);
    INSERT INTO _t VALUES ('other-user-forbidden', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('other-user-forbidden', SQLERRM = 'forbidden'); END;

  -- unknown id looks identical to "not yours"
  BEGIN
    PERFORM api_key_set_scopes(gen_random_uuid(), ARRAY['readiness:read']);
    INSERT INTO _t VALUES ('unknown-id-forbidden', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('unknown-id-forbidden', SQLERRM = 'forbidden'); END;

  -- ── app key: admin allowed, viewer and outsider forbidden ──────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  PERFORM api_key_set_scopes(v_app, ARRAY['products:read','readiness:read']);
  INSERT INTO _t VALUES ('app-admin-allowed',
    (SELECT scopes FROM tenant_api_keys WHERE id = v_app) = ARRAY['products:read','readiness:read']);
  INSERT INTO _t VALUES ('app-change-audited', EXISTS (
    SELECT 1 FROM tenant_audit_log WHERE tenant_id = v_tenant AND action = 'api_key.scopes_updated'
       AND resource = 'tenant_api_keys:id=' || v_app AND before_jsonb = '{"scopes":["readiness:read"]}'::jsonb));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_viewer)::text, true);
  BEGIN
    PERFORM api_key_set_scopes(v_app, ARRAY['products:sync']);
    INSERT INTO _t VALUES ('app-viewer-forbidden', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('app-viewer-forbidden', SQLERRM = 'forbidden'); END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  BEGIN
    PERFORM api_key_set_scopes(v_app, ARRAY['products:sync']);
    INSERT INTO _t VALUES ('app-outsider-forbidden', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('app-outsider-forbidden', SQLERRM = 'forbidden'); END;

  -- ── inactive keys, empty and unknown scopes ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  BEGIN
    PERFORM api_key_set_scopes(v_dead, ARRAY['readiness:read']);
    INSERT INTO _t VALUES ('revoked-key-not-active', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('revoked-key-not-active', SQLERRM = 'key_not_active'); END;
  BEGIN
    PERFORM api_key_set_scopes(v_old, ARRAY['readiness:read']);
    INSERT INTO _t VALUES ('expired-key-not-active', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('expired-key-not-active', SQLERRM = 'key_not_active'); END;
  BEGIN
    PERFORM api_key_set_scopes(v_app, ARRAY[]::TEXT[]);
    INSERT INTO _t VALUES ('empty-scopes-required', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('empty-scopes-required', SQLERRM = 'scopes_required'); END;
  BEGIN
    PERFORM api_key_set_scopes(v_app, ARRAY['readiness:read','billing:drain_everything']);
    INSERT INTO _t VALUES ('unknown-scope-refused', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('unknown-scope-refused', SQLERRM = 'unknown_scope'); END;
  INSERT INTO _t VALUES ('unknown-scope-left-row-unchanged',
    (SELECT scopes FROM tenant_api_keys WHERE id = v_app) = ARRAY['products:read','readiness:read']);

  -- ── signed out ──────────────────────────────────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM api_key_set_scopes(v_app, ARRAY['readiness:read']);
    INSERT INTO _t VALUES ('signed-out-refused', false);
  EXCEPTION WHEN raise_exception THEN INSERT INTO _t VALUES ('signed-out-refused', SQLERRM = 'unauthenticated'); END;
EXCEPTION WHEN undefined_function THEN
  INSERT INTO _t VALUES ('api_key_set_scopes-exists', false);
END $$;

-- grants: authenticated may call it, anon may not
INSERT INTO _t SELECT 'authenticated-can-execute',
  COALESCE(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false)
  FROM (SELECT to_regprocedure('public.api_key_set_scopes(uuid,text[])') AS oid) p;
INSERT INTO _t SELECT 'anon-cannot-execute',
  p.oid IS NOT NULL AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
  FROM (SELECT to_regprocedure('public.api_key_set_scopes(uuid,text[])') AS oid) p;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION '174 set-scopes assertions: % failed', failed;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
