-- Assertions for migration 226: the exit offer's save — admins only, the tenant's own percent-off coupon only.
BEGIN;
DO $$
DECLARE
  t UUID; other UUID; c UUID; theirs UUID; fixed UUID;
  admin UUID := gen_random_uuid(); outsider UUID := gen_random_uuid();
  r tenant_exit_survey;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t226', 'o226@x.test', 'pk_test_226a', 'pk_live_226a', 'whsec_t226a', 'whsec_l226a') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('o226', 'p226@x.test', 'pk_test_226b', 'pk_live_226b', 'whsec_t226b', 'whsec_l226b') RETURNING id INTO other;
  INSERT INTO auth.users (id, email) VALUES (admin, 'a226@test.local'), (outsider, 'x226@test.local');
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (t, admin, 'owner'), (other, outsider, 'owner');
  INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration, duration_in_months)
    VALUES (t, 'EXIT50', 50, 'repeating', 3) RETURNING id INTO c;
  INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration) VALUES (other, 'THEIRS', 50, 'once') RETURNING id INTO theirs;

  -- defaults: on, no coupon
  INSERT INTO tenant_exit_survey (tenant_id) VALUES (t) ON CONFLICT DO NOTHING;
  SELECT * INTO r FROM tenant_exit_survey WHERE tenant_id = t;
  IF NOT r.exit_offer_enabled OR r.exit_offer_coupon_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL 1: defaults'; END IF;
  RAISE NOTICE 'ok 1 - on by default, no coupon until one is attached';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  r := public.tenant_exit_offer_save(t, true, c);
  IF r.exit_offer_coupon_id <> c OR NOT r.exit_offer_enabled OR NOT r.enabled THEN RESET ROLE; RAISE EXCEPTION 'FAIL 2: save'; END IF;
  BEGIN
    PERFORM public.tenant_exit_offer_save(t, true, theirs);
    RESET ROLE; RAISE EXCEPTION 'FAIL 3: another tenant''s coupon accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
  r := public.tenant_exit_offer_save(t, false, c);
  IF r.exit_offer_enabled THEN RESET ROLE; RAISE EXCEPTION 'FAIL 4: switch off'; END IF;
  RESET ROLE;
  RAISE NOTICE 'ok 2 - admin saves, turns off; another tenant''s coupon refused';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.tenant_exit_offer_save(t, true, c);
    RESET ROLE; RAISE EXCEPTION 'FAIL 5: outsider saved';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  RESET ROLE;
  IF has_function_privilege('anon', 'public.tenant_exit_offer_save(uuid, boolean, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 6: anon can execute';
  END IF;
  RAISE NOTICE 'ok 3 - outsiders and anon refused';

  -- deleting the coupon detaches it
  DELETE FROM tenant_coupons WHERE id = c;
  IF (SELECT exit_offer_coupon_id FROM tenant_exit_survey WHERE tenant_id = t) IS NOT NULL THEN RAISE EXCEPTION 'FAIL 7'; END IF;
  RAISE NOTICE 'PASS 226_exit_offer: 4/4 groups ok';
END $$;
ROLLBACK;
