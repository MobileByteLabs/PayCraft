-- Assertions for migration 181 (exit survey config, survey responses, win-back offers).
--
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/181_exit_survey_winback_test.sql
--
-- Before 181 every assertion FAILS (the tables do not exist); after it all pass.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant UUID;
  v_coupon UUID;
  v_err    TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('survey-181-fixture','survey181@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;

  -- A new tenant gets the default survey: six reasons, enabled, asked at most every 7 days.
  INSERT INTO _t VALUES ('a new tenant gets the default survey',
    EXISTS (SELECT 1 FROM tenant_exit_survey WHERE tenant_id = v_tenant AND enabled AND survey_cap_days = 7
            AND jsonb_array_length(reasons) = 6));
  INSERT INTO _t VALUES ('the default reasons are the agreed six', (
    SELECT array_agg(r->>'code' ORDER BY ord) FROM tenant_exit_survey, jsonb_array_elements(reasons) WITH ORDINALITY AS x(r, ord)
    WHERE tenant_id = v_tenant) = ARRAY['too_expensive','just_looking','payment_method','trust','features','other']);
  INSERT INTO _t VALUES ('every existing tenant has a survey row',
    NOT EXISTS (SELECT 1 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM tenant_exit_survey s WHERE s.tenant_id = t.id)));

  BEGIN
    UPDATE tenant_exit_survey SET survey_cap_days = 0 WHERE tenant_id = v_tenant;
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('a 0-day cap is refused', v_err IS NOT NULL);

  BEGIN
    UPDATE tenant_exit_survey SET reasons = '{"not":"an array"}' WHERE tenant_id = v_tenant;
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('reasons must be an array', v_err IS NOT NULL);

  -- Responses: free text is capped.
  INSERT INTO exit_survey_responses (tenant_id, user_ref, step, reason_code, platform, country)
  VALUES (v_tenant, 'u1', 'checkout', 'too_expensive', 'web', 'IN');
  BEGIN
    INSERT INTO exit_survey_responses (tenant_id, step, reason_code, free_text, platform) VALUES (v_tenant, 'paywall', 'other', repeat('x', 501), 'android');
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('free text over 500 characters is refused', v_err IS NOT NULL);

  -- Offers: each coupon at most once per buyer.
  INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration) VALUES (v_tenant, 'WINBACK50', 50, 'once') RETURNING id INTO v_coupon;
  INSERT INTO winback_offers (tenant_id, user_ref, coupon_id, reason_code, expires_at)
  VALUES (v_tenant, 'u1', v_coupon, 'too_expensive', now() + interval '48 hours');
  BEGIN
    INSERT INTO winback_offers (tenant_id, user_ref, coupon_id, reason_code, expires_at)
    VALUES (v_tenant, 'u1', v_coupon, 'too_expensive', now() + interval '48 hours');
    v_err := NULL;
  EXCEPTION WHEN unique_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('the same offer twice to one buyer is refused', v_err IS NOT NULL);

  INSERT INTO _t VALUES ('row level security is on for all three', (
    SELECT bool_and(relrowsecurity) FROM pg_class WHERE relname IN ('tenant_exit_survey','exit_survey_responses','winback_offers')));
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
