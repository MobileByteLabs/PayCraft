-- Assertions for migration 175 (revoking an account-scoped key actually revokes it).
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/175_account_key_revoke_test.sql
--
-- Against 137's function the account-key cases fail ('unknown_key' for a key that exists).

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;
GRANT ALL ON _t TO authenticated;

DO $$
DECLARE
  v_owner   UUID := gen_random_uuid();
  v_other   UUID := gen_random_uuid();
  v_tenant  UUID;
  v_tenant2 UUID;
  v_acct    UUID;
  v_acct2   UUID;
  v_app     UUID;
  v_audit   INT;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'owner175@test.local'), (v_other, 'other175@test.local');
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('revoke-175-a','a175@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING id INTO v_tenant;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('revoke-175-b','b175@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING id INTO v_tenant2;
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES
    (v_tenant, v_owner, 'owner'), (v_tenant2, v_owner, 'admin'), (v_tenant2, v_other, 'owner');

  INSERT INTO tenant_api_keys (tenant_id, owner_user_id, name, key_prefix, key_hash, scopes, expires_at)
  VALUES (NULL, v_owner, 'acct', 'pcsk_acct', md5(random()::text), ARRAY['readiness:read'], now() + interval '30 days')
  RETURNING id INTO v_acct;
  INSERT INTO tenant_api_keys (tenant_id, owner_user_id, name, key_prefix, key_hash, scopes, expires_at)
  VALUES (NULL, v_owner, 'acct2', 'pcsk_acc2', md5(random()::text), ARRAY['readiness:read'], now() + interval '30 days')
  RETURNING id INTO v_acct2;
  INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
  VALUES (v_tenant, 'app', 'pcsk_app', md5(random()::text), ARRAY['readiness:read']) RETURNING id INTO v_app;

  -- ── the bug: the signed-in owner's direct UPDATE is a silent no-op under RLS ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  UPDATE tenant_api_keys SET revoked_at = now() WHERE id = v_acct2 AND owner_user_id = v_owner;
  RESET ROLE;
  INSERT INTO _t VALUES ('direct-update-is-a-noop-under-rls',
    (SELECT revoked_at IS NULL FROM tenant_api_keys WHERE id = v_acct2));

  -- ── another user cannot revoke the owner's account key ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  BEGIN
    PERFORM tenant_api_key_revoke(v_acct);
    INSERT INTO _t VALUES ('other-user-forbidden', false);
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO _t VALUES ('other-user-forbidden', SQLERRM = 'forbidden');
  END;
  INSERT INTO _t VALUES ('still-active-after-refusal',
    (SELECT revoked_at IS NULL FROM tenant_api_keys WHERE id = v_acct));

  -- ── the owner revokes it through the RPC: revoked, audited in every app it reached ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  INSERT INTO _t VALUES ('owner-revoke-returns-true', tenant_api_key_revoke(v_acct));
  INSERT INTO _t VALUES ('account-key-revoked',
    (SELECT revoked_at IS NOT NULL FROM tenant_api_keys WHERE id = v_acct));
  SELECT count(*) INTO v_audit FROM tenant_audit_log
   WHERE action = 'api_key.revoked' AND resource = 'tenant_api_keys:id=' || v_acct::TEXT;
  INSERT INTO _t VALUES ('audited-in-both-reached-apps', v_audit = 2);

  -- ── app keys: 137 behaviour unchanged ──
  INSERT INTO _t VALUES ('app-key-admin-revokes', tenant_api_key_revoke(v_app));
  INSERT INTO _t VALUES ('app-key-revoked',
    (SELECT revoked_at IS NOT NULL FROM tenant_api_keys WHERE id = v_app));
  BEGIN
    PERFORM tenant_api_key_revoke(gen_random_uuid());
    INSERT INTO _t VALUES ('unknown-key-refused', false);
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO _t VALUES ('unknown-key-refused', SQLERRM = 'unknown_key');
  END;
END $$;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN RAISE EXCEPTION '175 revoke assertions: % failed', failed; END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
