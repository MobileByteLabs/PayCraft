-- Assertions for migration 179 (SKU naming convention: lowercase kebab-case; existing SKUs grandfathered).
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/179_sku_naming_convention_test.sql
--
-- Before 179 the "rejects" assertions FAIL (any SKU went in); after it all pass.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant UUID;
  v_id     UUID;
  v_err    TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('sku-179-fixture','sku179@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;

  -- the pattern itself
  INSERT INTO _t VALUES ('canonical: pro-monthly', paycraft_sku_is_canonical('pro-monthly'));
  INSERT INTO _t VALUES ('canonical: coins-100', paycraft_sku_is_canonical('coins-100'));
  INSERT INTO _t VALUES ('canonical: lifetime', paycraft_sku_is_canonical('lifetime'));
  INSERT INTO _t VALUES ('not canonical: snake', NOT paycraft_sku_is_canonical('pro_monthly'));
  INSERT INTO _t VALUES ('not canonical: reverse-DNS', NOT paycraft_sku_is_canonical('com.x.app.sub.month'));
  INSERT INTO _t VALUES ('not canonical: upper', NOT paycraft_sku_is_canonical('Pro-Monthly'));
  INSERT INTO _t VALUES ('not canonical: double hyphen', NOT paycraft_sku_is_canonical('pro--monthly'));
  INSERT INTO _t VALUES ('not canonical: edge hyphen', NOT paycraft_sku_is_canonical('-pro'));
  INSERT INTO _t VALUES ('not canonical: 1 char', NOT paycraft_sku_is_canonical('p'));
  INSERT INTO _t VALUES ('not canonical: 65 chars', NOT paycraft_sku_is_canonical(repeat('a', 65)));

  -- a new canonical SKU goes in through the upsert RPC
  v_id := tenant_products_upsert(jsonb_build_object(
    'tenant_id', v_tenant, 'sku', 'pro-monthly', 'type', 'subscription', 'display_name', 'Pro Monthly',
    'interval', 'month', 'base_price_cents', 999));
  INSERT INTO _t VALUES ('creates a kebab-case SKU', v_id IS NOT NULL);

  -- a new non-canonical SKU is refused, with the rule in the message
  BEGIN
    PERFORM tenant_products_upsert(jsonb_build_object(
      'tenant_id', v_tenant, 'sku', 'pro_annual', 'type', 'subscription', 'display_name', 'Pro Annual',
      'interval', 'year', 'base_price_cents', 9900));
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('rejects a new snake_case SKU', v_err LIKE 'sku_not_canonical:%kebab-case%');

  -- renaming to a non-canonical SKU is refused
  BEGIN
    UPDATE tenant_products SET sku = 'Pro.Monthly' WHERE id = v_id;
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('rejects renaming to a non-canonical SKU', v_err LIKE 'sku_not_canonical:%');

  -- a grandfathered SKU (written before 179 — simulated with the trigger off) keeps working
  ALTER TABLE tenant_products DISABLE TRIGGER tenant_products_sku_convention;
  INSERT INTO tenant_products (tenant_id, sku, type, display_name, interval, base_price_cents)
  VALUES (v_tenant, 'com.x.app.sub.week', 'subscription', 'Weekly', 'week', 199);
  ALTER TABLE tenant_products ENABLE TRIGGER tenant_products_sku_convention;

  UPDATE tenant_products SET display_name = 'Weekly Pro' WHERE tenant_id = v_tenant AND sku = 'com.x.app.sub.week';
  INSERT INTO _t VALUES ('a grandfathered SKU can still be edited',
    (SELECT display_name FROM tenant_products WHERE tenant_id = v_tenant AND sku = 'com.x.app.sub.week') = 'Weekly Pro');

  v_err := NULL;
  BEGIN
    PERFORM tenant_products_upsert(jsonb_build_object(
      'tenant_id', v_tenant, 'sku', 'com.x.app.sub.week', 'type', 'subscription', 'display_name', 'Weekly',
      'interval', 'week', 'base_price_cents', 299));
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('a grandfathered SKU can still be upserted', v_err IS NULL);
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
