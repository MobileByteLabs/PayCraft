-- Assertions for migration 183 (the dashboard's exit-survey editor: tenant_exit_survey_save).
--
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/183_exit_survey_editor_test.sql
--
-- Before 183 every assertion FAILS (the function does not exist); after it all pass. The error codes are the
-- ones dashboard/lib/exit-survey-config.ts returns for the same inputs (its test uses these cases).

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

CREATE OR REPLACE FUNCTION pg_temp.save_error(p_tenant UUID, p_reasons JSONB, p_title TEXT DEFAULT 'Why not?',
                                             p_cap INT DEFAULT 7, p_hours INT DEFAULT 48) RETURNS TEXT AS $$
BEGIN
  PERFORM tenant_exit_survey_save(p_tenant, true, p_title, p_reasons, p_cap, p_hours);
  RETURN NULL;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN regexp_replace(SQLERRM, '^invalid_exit_survey: ', '');
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_tenant UUID;
  v_other  UUID;
  v_coupon UUID;
  v_foreign_coupon UUID;
  v_admin  UUID := gen_random_uuid();
  v_row    tenant_exit_survey;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('survey-183-fixture','survey183@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('survey-183-other','survey183o@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_other;
  INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration) VALUES (v_tenant, 'WINBACK50', 50, 'once') RETURNING id INTO v_coupon;
  INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration) VALUES (v_other, 'THEIRS', 50, 'once') RETURNING id INTO v_foreign_coupon;

  -- Not an admin of the tenant (no jwt → auth.uid() NULL): refused, before any admin exists.
  BEGIN
    PERFORM tenant_exit_survey_save(v_tenant, true, 'Why not?', '[{"code":"just_looking","label":"Just looking","action":"none"}]', 7, 48);
    INSERT INTO _t VALUES ('a non-admin cannot save', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES ('a non-admin cannot save', true);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (v_tenant, v_admin, 'owner');

  -- A valid survey saves, normalised to the known keys (an unknown key is dropped).
  v_row := tenant_exit_survey_save(v_tenant, false, 'Before you go?', jsonb_build_array(
    jsonb_build_object('code','too_expensive','label','Too expensive','enabled',true,'action','offer','coupon_id',v_coupon,'junk','x'),
    jsonb_build_object('code','payment_method','label','No UPI','enabled',true,'action','message','message','UPI on the web'),
    jsonb_build_object('code','other','label','Something else','enabled',true,'action','none','free_text',true)), 14, 24);
  INSERT INTO _t VALUES ('a valid survey saves', v_row.title = 'Before you go?' AND NOT v_row.enabled
    AND v_row.survey_cap_days = 14 AND v_row.offer_hours = 24 AND jsonb_array_length(v_row.reasons) = 3);
  INSERT INTO _t VALUES ('unknown keys are dropped', NOT (v_row.reasons->0 ? 'junk'));
  INSERT INTO _t VALUES ('the coupon and free text are kept', v_row.reasons->0->>'coupon_id' = v_coupon::text
    AND (v_row.reasons->2->>'free_text')::boolean);

  -- Each rule, with the error the dashboard shows.
  INSERT INTO _t VALUES ('an enabled offer without a coupon', pg_temp.save_error(v_tenant,
    '[{"code":"too_expensive","label":"Too expensive","enabled":true,"action":"offer"}]') = 'offer_needs_coupon:too_expensive');
  INSERT INTO _t VALUES ('another tenant''s coupon', pg_temp.save_error(v_tenant, jsonb_build_array(jsonb_build_object(
    'code','too_expensive','label','Too expensive','enabled',true,'action','offer','coupon_id',v_foreign_coupon))) = 'unknown_coupon:too_expensive');
  INSERT INTO _t VALUES ('a disabled offer may wait for its coupon', pg_temp.save_error(v_tenant,
    '[{"code":"too_expensive","label":"Too expensive","enabled":false,"action":"offer"},{"code":"just_looking","label":"Just looking","action":"none"}]') IS NULL);
  INSERT INTO _t VALUES ('an empty message', pg_temp.save_error(v_tenant,
    '[{"code":"trust","label":"Trust","action":"message","message":"  "}]') = 'message_1_to_200_chars:trust');
  INSERT INTO _t VALUES ('a blank label', pg_temp.save_error(v_tenant,
    '[{"code":"trust","label":" ","action":"none"}]') = 'label_1_to_60_chars:trust');
  INSERT INTO _t VALUES ('a bad code', pg_temp.save_error(v_tenant,
    '[{"code":"Too-Expensive","label":"x","action":"none"}]') = 'bad_code:Too-Expensive');
  INSERT INTO _t VALUES ('a duplicate code', pg_temp.save_error(v_tenant,
    '[{"code":"a","label":"x","action":"none"},{"code":"a","label":"y","action":"none"}]') = 'duplicate_code:a');
  INSERT INTO _t VALUES ('all reasons off', pg_temp.save_error(v_tenant,
    '[{"code":"a","label":"x","enabled":false,"action":"none"}]') = 'at_least_one_reason');
  INSERT INTO _t VALUES ('a 0-day cap', pg_temp.save_error(v_tenant,
    '[{"code":"a","label":"x","action":"none"}]', 'Why not?', 0) = 'cap_days_1_to_90');
  INSERT INTO _t VALUES ('a blank question', pg_temp.save_error(v_tenant,
    '[{"code":"a","label":"x","action":"none"}]', '  ') = 'title_1_to_80_chars');
  INSERT INTO _t VALUES ('no reasons', pg_temp.save_error(v_tenant, '[]') = 'reasons_1_to_12');

  -- An admin of one tenant cannot save another's.
  BEGIN
    PERFORM tenant_exit_survey_save(v_other, true, 'Why not?', '[{"code":"a","label":"x","action":"none"}]', 7, 48);
    INSERT INTO _t VALUES ('an admin cannot save another tenant''s survey', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES ('an admin cannot save another tenant''s survey', true);
  END;
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
