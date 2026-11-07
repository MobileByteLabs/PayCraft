-- Assertions for migration 171 (tenant_products_upsert restores what 158 dropped).
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/171_product_upsert_restore_columns_test.sql
--
-- Against 158 the column, guard and natural-key assertions FAIL; against 171 all pass.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant UUID;
  v_admin  UUID := gen_random_uuid();
  v_other  UUID := gen_random_uuid();
  v_id     UUID;
  v_id2    UUID;
  r        tenant_products;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('upsert-171-fixture','upsert171@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;

  -- Service-role path (auth.uid() NULL): create with trial OFF, then flip every dropped column.
  v_id := tenant_products_upsert(jsonb_build_object(
    'tenant_id', v_tenant, 'sku', 'pro-monthly', 'type', 'subscription', 'display_name', 'Pro Monthly',
    'interval', 'month', 'base_price_cents', 999, 'trial_enabled', false, 'trial_duration_days', 7));

  v_id2 := tenant_products_upsert(jsonb_build_object(
    'tenant_id', v_tenant, 'sku', 'pro-monthly', 'type', 'subscription', 'display_name', 'Pro Monthly',
    'interval', 'month', 'base_price_cents', 999,
    'trial_enabled', true, 'trial_duration_days', 14, 'trial_per_platform', '{"ios":3}',
    'store_description', 'Unlimited HD downloads', 'pricing_mode', 'global',
    'global_price_cents', 899, 'global_currency', 'EUR', 'discount_percent', 20,
    'discount_ends_at', '2027-01-01T00:00:00Z',
    'play_product_id', 'pro_monthly', 'app_store_product_id', 'com.example.promonthly'));
  SELECT * INTO r FROM tenant_products WHERE id = v_id;

  INSERT INTO _t VALUES ('natural-key-updates-same-row', v_id = v_id2);
  INSERT INTO _t VALUES ('trial_enabled-persists', r.trial_enabled = true);
  INSERT INTO _t VALUES ('trial_duration_days-persists', r.trial_duration_days = 14);
  INSERT INTO _t VALUES ('trial_per_platform-persists', r.trial_per_platform = '{"ios":3}'::jsonb);
  INSERT INTO _t VALUES ('store_description-persists', r.store_description = 'Unlimited HD downloads');
  INSERT INTO _t VALUES ('pricing_mode-persists', r.pricing_mode::text = 'global');
  INSERT INTO _t VALUES ('global_price-persists', r.global_price_cents = 899 AND r.global_currency = 'EUR');
  INSERT INTO _t VALUES ('discount-persists',
    r.discount_percent = 20 AND r.discount_ends_at = '2027-01-01T00:00:00Z'::timestamptz);
  INSERT INTO _t VALUES ('store-ids-persist',
    r.play_product_id = 'pro_monthly' AND r.app_store_product_id = 'com.example.promonthly');

  -- 158's consumable rule must survive.
  BEGIN
    PERFORM tenant_products_upsert(jsonb_build_object(
      'tenant_id', v_tenant, 'sku', 'coins-100', 'type', 'consumable', 'display_name', 'Coins'));
    INSERT INTO _t VALUES ('consumable-without-grant-rejected', false);
  EXCEPTION WHEN check_violation THEN
    INSERT INTO _t VALUES ('consumable-without-grant-rejected', true);
  END;
  v_id := tenant_products_upsert(jsonb_build_object(
    'tenant_id', v_tenant, 'sku', 'coins-100', 'type', 'consumable', 'display_name', 'Coins',
    'grant_quantity', 100));
  INSERT INTO _t VALUES ('consumable-grant-persists',
    (SELECT grant_quantity FROM tenant_products WHERE id = v_id) = 100);

  -- The tenant-admin guard (083/084) must be back: a signed-in NON-admin is refused.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other)::text, true);
  BEGIN
    PERFORM tenant_products_upsert(jsonb_build_object(
      'tenant_id', v_tenant, 'sku', 'intruder', 'type', 'subscription', 'display_name', 'x',
      'interval', 'month'));
    INSERT INTO _t VALUES ('non-admin-refused', false);
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO _t VALUES ('non-admin-refused', SQLERRM = 'forbidden');
  END;

  -- …and an admin is allowed.
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (v_tenant, v_admin, 'owner');
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  v_id := tenant_products_upsert(jsonb_build_object(
    'tenant_id', v_tenant, 'sku', 'pro-annual', 'type', 'subscription', 'display_name', 'Pro Annual',
    'interval', 'year', 'trial_enabled', true));
  INSERT INTO _t VALUES ('admin-allowed', v_id IS NOT NULL);
END $$;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION '171 upsert assertions: % failed', failed;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
