-- Assertions for migration 184 (a tenant's GA4 property, read with PayCraft's Viewer service account).
--
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/184_tenant_ga4_connection_test.sql
--
-- Before 184 every assertion FAILS (the table does not exist); after it all pass.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant UUID;
  v_other  UUID;
  v_admin  UUID := gen_random_uuid();
  v_err    TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('ga4-184-fixture','ga4184@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('ga4-184-other','ga4184o@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_other;

  BEGIN
    PERFORM tenant_ga4_connection_save(v_tenant, '123456789', true, NULL);
    INSERT INTO _t VALUES ('a non-admin cannot connect', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _t VALUES ('a non-admin cannot connect', true);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (v_tenant, v_admin, 'owner');

  PERFORM tenant_ga4_connection_save(v_tenant, '123456789', true, NULL);
  INSERT INTO _t VALUES ('a verified connection is stored', EXISTS (SELECT 1 FROM tenant_ga4_connections
    WHERE tenant_id = v_tenant AND property_id = '123456789' AND verified_at IS NOT NULL AND last_error IS NULL));

  PERFORM tenant_ga4_connection_save(v_tenant, '123456789', false, 'no_access');
  INSERT INTO _t VALUES ('a failed check keeps the property, clears verified, records why', EXISTS (SELECT 1 FROM tenant_ga4_connections
    WHERE tenant_id = v_tenant AND verified_at IS NULL AND last_error = 'no_access'));

  BEGIN
    PERFORM tenant_ga4_connection_save(v_tenant, 'properties/123', true, NULL);
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('a property id is digits only (6–12)', v_err IS NOT NULL);

  BEGIN
    PERFORM tenant_ga4_connection_save(v_other, '123456789', true, NULL);
    INSERT INTO _t VALUES ('an admin cannot connect another tenant', false);
  EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _t VALUES ('an admin cannot connect another tenant', true);
  END;

  PERFORM tenant_ga4_connection_delete(v_tenant);
  INSERT INTO _t VALUES ('disconnect removes it', NOT EXISTS (SELECT 1 FROM tenant_ga4_connections WHERE tenant_id = v_tenant));

  INSERT INTO _t VALUES ('row level security is on', (SELECT relrowsecurity FROM pg_class WHERE relname = 'tenant_ga4_connections'));
END $$;

DO $$
DECLARE r RECORD; failed INT := 0;
BEGIN
  FOR r IN SELECT * FROM _t LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
    IF NOT r.ok THEN failed := failed + 1; END IF;
  END LOOP;
  IF failed > 0 THEN RAISE EXCEPTION '% assertion(s) failed', failed; END IF;
END $$;

ROLLBACK;
