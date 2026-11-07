-- Assertions for migration 173 (onboarding/apps:write scopes + service_role on paywall write RPCs).
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/173_api_paywall_onboarding_write_path_test.sql
--
-- Against 172 the scope and service-role assertions FAIL; against 173 all pass.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant UUID;
  v_admin  UUID := gen_random_uuid();
  v_other  UUID := gen_random_uuid();
  v_slug   TEXT;
  v_msg    TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('api-173-fixture','api173@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;

  -- ── scopes ──
  BEGIN
    INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
    VALUES (v_tenant, 'k173', 'pcsk_173', 'h173-'||gen_random_uuid(),
            ARRAY['onboarding:read','onboarding:write','paywall:write','apps:write']);
    INSERT INTO _t VALUES ('new-scopes-grantable', true);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _t VALUES ('new-scopes-grantable', false);
  END;
  BEGIN
    INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes)
    VALUES (v_tenant, 'k173b', 'pcsk_17b', 'h173b-'||gen_random_uuid(), ARRAY['onboarding:admin']);
    INSERT INTO _t VALUES ('unknown-scope-still-refused', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _t VALUES ('unknown-scope-still-refused', true);
  END;
  INSERT INTO _t VALUES ('existing-scopes-kept',
    (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'tenant_api_keys_scopes_known')
      LIKE ALL (ARRAY['%providers:read%','%products:sync%','%webhooks:read%','%apps:provision%','%keys:rotate%']));

  -- ── service_role: every paywall write RPC gets past the admin guard ──
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);

  PERFORM tenant_paywall_upsert(jsonb_build_object('tenant_id', v_tenant, 'hero_title', 'From the API'));
  INSERT INTO _t VALUES ('service-role-paywall-upsert',
    (SELECT hero_title FROM tenant_paywall WHERE tenant_id = v_tenant) = 'From the API');

  SELECT slug INTO v_slug FROM paywall_templates WHERE is_active ORDER BY slug LIMIT 1;
  IF v_slug IS NOT NULL THEN
    PERFORM tenant_paywall_apply_template(v_tenant, v_slug, 'create');
    INSERT INTO _t VALUES ('service-role-apply-template', true);
    PERFORM tenant_paywall_publish(v_tenant);
    INSERT INTO _t VALUES ('service-role-publish', true);
  END IF;

  -- workflow_upsert: an invalid workflow must fail VALIDATION, not authorization.
  BEGIN
    PERFORM tenant_paywall_workflow_upsert(v_tenant, '{}'::jsonb);
    INSERT INTO _t VALUES ('service-role-workflow-upsert-reaches-validator', false);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO _t VALUES ('service-role-workflow-upsert-reaches-validator', SQLERRM <> 'forbidden');
  END;

  -- ── the authenticated branch is untouched ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM tenant_paywall_upsert(jsonb_build_object('tenant_id', v_tenant, 'hero_title', 'intruder'));
    INSERT INTO _t VALUES ('non-admin-upsert-refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES ('non-admin-upsert-refused', SQLERRM = 'forbidden');
  END;
  BEGIN
    PERFORM tenant_paywall_publish(v_tenant);
    INSERT INTO _t VALUES ('non-admin-publish-refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES ('non-admin-publish-refused', true);
  END;

  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (v_tenant, v_admin, 'owner');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM tenant_paywall_upsert(jsonb_build_object('tenant_id', v_tenant, 'hero_title', 'By the admin'));
  INSERT INTO _t VALUES ('admin-upsert-allowed',
    (SELECT hero_title FROM tenant_paywall WHERE tenant_id = v_tenant) = 'By the admin');

  -- no claims at all (anon-shaped) is still refused
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM tenant_paywall_upsert(jsonb_build_object('tenant_id', v_tenant));
    INSERT INTO _t VALUES ('no-claims-refused', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES ('no-claims-refused', true);
  END;
END $$;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION '173 assertions: % failed', failed;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
