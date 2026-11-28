-- Assertions for migration 227: variant exit offer / design (save + serve), revenue in results, promote.
BEGIN;
DO $$
DECLARE
  t UUID; other UUID; o1 UUID; o2 UUID; c UUID; theirs UUID; base JSONB; served JSONB; err TEXT;
  r RECORD; e paywall_experiments;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('exp-227','e227@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('exp-227-o','o227@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO other;
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name, is_current) VALUES (t, 'control', 'Control', true) RETURNING id INTO o1;
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name) VALUES (t, 'b', 'B') RETURNING id INTO o2;
  WITH p AS (INSERT INTO tenant_packages (offering_id, tenant_id, role_identifier, display_name)
             VALUES (o1, t, '$rc_monthly', 'Monthly'), (o2, t, '$rc_annual', 'Annual') RETURNING id, offering_id)
  INSERT INTO tenant_products (tenant_id, sku, type, display_name, package_id)
  SELECT t, CASE WHEN p.offering_id = o1 THEN 'pro-monthly' ELSE 'pro-annual' END, 'subscription', 'Pro', p.id FROM p;
  INSERT INTO tenant_pricing (tenant_id, product_id, locale, amount_cents, currency)
  SELECT t, id, 'en-IN', CASE WHEN sku = 'pro-monthly' THEN 19900 ELSE 99900 END, 'INR' FROM tenant_products WHERE tenant_id = t;
  INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration, duration_in_months) VALUES (t, 'EXIT30', 30, 'repeating', 3) RETURNING id INTO c;
  INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration) VALUES (other, 'THEIRS', 50, 'once') RETURNING id INTO theirs;
  INSERT INTO tenant_exit_survey (tenant_id) VALUES (t) ON CONFLICT DO NOTHING;

  base := jsonb_build_array(jsonb_build_object('key', 'control', 'weight', 50, 'offering_id', o1),
                            jsonb_build_object('key', 'b', 'weight', 50, 'offering_id', o2));

  -- 1. bad values refused with their codes
  FOR r IN SELECT * FROM (VALUES
    (jsonb_set(base, '{1,exit_offer}', '"no"'), 'experiment_exit_offer_invalid'),
    (jsonb_set(base, '{1,exit_offer_coupon_id}', to_jsonb(theirs::text)), 'experiment_exit_coupon_unknown'),
    (jsonb_set(base, '{1,paywall_template}', '"fancy"'), 'experiment_template_unknown')
  ) AS x(v, code) LOOP
    err := NULL;
    BEGIN PERFORM paywall_experiment_save(t, 'tpl', '', r.v); EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
    IF err IS DISTINCT FROM r.code THEN RAISE EXCEPTION 'FAIL 1: % → want %, got %', r.v, r.code, err; END IF;
  END LOOP;
  RAISE NOTICE 'ok 1 - invalid exit offer / foreign coupon / unknown template refused';

  -- 2. served: control untouched (221 shape), b with its coupon's discount and design; exit_offer false served as false
  PERFORM paywall_experiment_save(t, 'tpl', '', jsonb_set(jsonb_set(jsonb_set(base,
    '{1,exit_offer_coupon_id}', to_jsonb(c::text)), '{1,paywall_template}', '"minimal"'), '{1,default_sku}', '"pro-annual"'));
  PERFORM paywall_experiment_set_status(t, 'tpl', 'running');
  served := paywall_experiment_public_get(t);
  IF served->'variants'->0 <> jsonb_build_object('key', 'control', 'weight', 50, 'offering_id', o1::text) THEN
    RAISE EXCEPTION 'FAIL 2a: control served as %', served->'variants'->0; END IF;
  IF served->'variants'->1->'exit_offer' <> '{"percent_off":30,"duration":"repeating","duration_in_months":3}'::jsonb
     OR served->'variants'->1->>'paywall_template' <> 'minimal' THEN
    RAISE EXCEPTION 'FAIL 2b: b served as %', served->'variants'->1; END IF;
  RAISE NOTICE 'ok 2 - variant exit offer and design served; control byte-identical';

  -- 3. revenue: b has 2 buyers of annual (one success event repeated), control 1 viewer no buyer
  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, mode, occurred_at, experiment, variant, sku, currency) VALUES
    (t, 'd1', 'paycraft_paywall_view', 'paywall', 'android', 'live', now(), 'tpl', 'control', NULL, NULL),
    (t, 'd2', 'paycraft_paywall_view', 'paywall', 'android', 'live', now(), 'tpl', 'b', NULL, NULL),
    (t, 'd3', 'paycraft_paywall_view', 'paywall', 'android', 'live', now(), 'tpl', 'b', NULL, NULL),
    (t, 'd2', 'paycraft_offer_view', 'paywall', 'android', 'live', now(), 'tpl', 'b', NULL, NULL),
    (t, 'd2', 'paycraft_purchase_success', 'paywall', 'android', 'live', now(), 'tpl', 'b', 'pro-annual', 'INR'),
    (t, 'd2', 'paycraft_purchase_success', 'paywall', 'android', 'live', now(), 'tpl', 'b', 'pro-annual', 'INR'),
    (t, 'd3', 'paycraft_purchase_success', 'paywall', 'android', 'live', now(), 'tpl', 'b', 'pro-annual', 'INR');
  SELECT * INTO r FROM paywall_experiment_results(t, 'tpl') WHERE variant = 'b';
  IF r.buyers <> 2 OR r.offer_views <> 1 OR r.revenue <> '{"INR": 199800}'::jsonb THEN
    RAISE EXCEPTION 'FAIL 3: b = %', r; END IF;
  SELECT * INTO r FROM paywall_experiment_results(t, 'tpl') WHERE variant = 'control';
  IF r.viewers <> 1 OR r.revenue <> '{}'::jsonb THEN RAISE EXCEPTION 'FAIL 3b: control = %', r; END IF;
  RAISE NOTICE 'ok 3 - revenue per currency, one purchase per device and sku';

  -- 4. promote b: current offering, popular plan, design, exit coupon; experiment stopped
  e := paywall_experiment_promote(t, 'tpl', 'b');
  IF e.status <> 'stopped' THEN RAISE EXCEPTION 'FAIL 4a: %', e.status; END IF;
  IF NOT (SELECT is_current FROM tenant_offerings WHERE id = o2) OR (SELECT is_current FROM tenant_offerings WHERE id = o1) THEN
    RAISE EXCEPTION 'FAIL 4b: offering not switched'; END IF;
  IF (SELECT exit_offer_coupon_id FROM tenant_exit_survey WHERE tenant_id = t) <> c THEN RAISE EXCEPTION 'FAIL 4c'; END IF;
  IF EXISTS (SELECT 1 FROM tenant_paywall WHERE tenant_id = t)
     AND (SELECT template FROM tenant_paywall WHERE tenant_id = t) <> 'minimal' THEN RAISE EXCEPTION 'FAIL 4d'; END IF;
  err := NULL;
  BEGIN PERFORM paywall_experiment_promote(t, 'tpl', 'zzz'); EXCEPTION WHEN OTHERS THEN err := SQLERRM; END;
  IF err IS DISTINCT FROM 'experiment_variant_unknown' THEN RAISE EXCEPTION 'FAIL 4e: %', err; END IF;
  RAISE NOTICE 'ok 4 - promote applies the winner and stops the test';

  IF has_function_privilege('authenticated', 'public.paywall_experiment_promote(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL 5: authenticated can promote directly'; END IF;
  RAISE NOTICE 'PASS 227_experiment_templates: 5/5 groups ok';
END $$;
ROLLBACK;
