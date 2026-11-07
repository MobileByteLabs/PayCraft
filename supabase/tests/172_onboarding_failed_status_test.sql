-- Assertions for migration 172 (onboarding steps can be recorded FAILED — with evidence only).
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/172_onboarding_failed_status_test.sql
--
-- Against 117/119 'failed-without-evidence-refused' FAILS (the trigger let it through); against 172
-- all pass, and the passed/blocked rules are unchanged.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant UUID;
  v_state  TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('onboard-172-fixture','onboard172@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;

  -- failed + evidence: accepted (the demotion rule 5 requires).
  INSERT INTO onboarding_app_state (tenant_id, current_step, steps)
  VALUES (v_tenant, 'A5', jsonb_build_array(jsonb_build_object(
    'id','A5','status','failed','evidence', jsonb_build_object('app_store','MISSING_METADATA'))));
  INSERT INTO _t VALUES ('failed-with-evidence-accepted',
    (SELECT steps->0->>'status' FROM onboarding_app_state WHERE tenant_id = v_tenant) = 'failed');

  -- failed WITHOUT evidence (absent key, then explicit null): refused.
  BEGIN
    UPDATE onboarding_app_state SET steps = '[{"id":"A5","status":"failed"}]'::jsonb WHERE tenant_id = v_tenant;
    INSERT INTO _t VALUES ('failed-without-evidence-refused', false);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_state = MESSAGE_TEXT;
    INSERT INTO _t VALUES ('failed-without-evidence-refused', v_state LIKE '%A5%failed%');
  END;
  BEGIN
    UPDATE onboarding_app_state SET steps = '[{"id":"A5","status":"failed","evidence":null}]'::jsonb WHERE tenant_id = v_tenant;
    INSERT INTO _t VALUES ('failed-null-evidence-refused', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _t VALUES ('failed-null-evidence-refused', true);
  END;

  -- passed: unchanged — evidence required, accepted with it.
  BEGIN
    UPDATE onboarding_app_state SET steps = '[{"id":"A5","status":"passed"}]'::jsonb WHERE tenant_id = v_tenant;
    INSERT INTO _t VALUES ('passed-without-evidence-refused', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _t VALUES ('passed-without-evidence-refused', true);
  END;
  UPDATE onboarding_app_state SET steps = '[{"id":"A5","status":"passed","evidence":{"ready":true}}]'::jsonb
   WHERE tenant_id = v_tenant;
  INSERT INTO _t VALUES ('passed-with-evidence-accepted',
    (SELECT steps->0->>'status' FROM onboarding_app_state WHERE tenant_id = v_tenant) = 'passed');

  -- blocked: unchanged — reason required, and from the closed enum.
  BEGIN
    UPDATE onboarding_app_state SET steps = '[{"id":"A7","status":"blocked"}]'::jsonb WHERE tenant_id = v_tenant;
    INSERT INTO _t VALUES ('blocked-without-reason-refused', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _t VALUES ('blocked-without-reason-refused', true);
  END;
  BEGIN
    UPDATE onboarding_app_state SET steps = '[{"id":"A7","status":"blocked","blocked_reason":"bogus"}]'::jsonb
     WHERE tenant_id = v_tenant;
    INSERT INTO _t VALUES ('blocked-unknown-reason-refused', false);
  EXCEPTION WHEN invalid_text_representation THEN
    INSERT INTO _t VALUES ('blocked-unknown-reason-refused', true);
  END;
  UPDATE onboarding_app_state
     SET steps = '[{"id":"A7","status":"blocked","blocked_reason":"pending-device-verify"}]'::jsonb
   WHERE tenant_id = v_tenant;
  INSERT INTO _t VALUES ('blocked-with-reason-accepted',
    (SELECT steps->0->>'blocked_reason' FROM onboarding_app_state WHERE tenant_id = v_tenant) = 'pending-device-verify');
END $$;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION '172 onboarding assertions: % failed', failed;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
