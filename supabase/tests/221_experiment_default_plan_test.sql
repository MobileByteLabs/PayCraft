-- Assertions for migration 221 (an experiment variant's `default_sku`: validated on save, served to the SDK).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/221_experiment_default_plan_test.sql
BEGIN;
DO $$
DECLARE
  t UUID; other UUID; o1 UUID; o2 UUID; served JSONB;
  base JSONB;
  expect_error TEXT;
  r RECORD;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('exp-221','e221@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('exp-221-other','o221@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id INTO other;
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name, is_current) VALUES (t, 'control', 'Control', true) RETURNING id INTO o1;
  INSERT INTO tenant_offerings (tenant_id, identifier, display_name) VALUES (t, 'monthly-first', 'Monthly first') RETURNING id INTO o2;
  -- control sells quarterly + monthly; monthly-first sells monthly-b only; pro-retired is inactive.
  WITH p AS (
    INSERT INTO tenant_packages (offering_id, tenant_id, role_identifier, display_name)
    VALUES (o1, t, '$rc_three_month', 'Quarterly'), (o1, t, '$rc_monthly', 'Monthly'), (o2, t, '$rc_monthly', 'Monthly')
    RETURNING id, offering_id, role_identifier)
  INSERT INTO tenant_products (tenant_id, sku, type, display_name, package_id)
  SELECT t, CASE WHEN p.offering_id = o2 THEN 'pro-monthly-b'
                 WHEN p.role_identifier = '$rc_three_month' THEN 'pro-quarterly' ELSE 'pro-monthly' END,
         'subscription', 'Pro', p.id FROM p;
  INSERT INTO tenant_products (tenant_id, sku, type, display_name, package_id, active)
  SELECT t, 'pro-retired', 'subscription', 'Old', id, false FROM tenant_packages WHERE offering_id = o1 LIMIT 1;
  INSERT INTO tenant_products (tenant_id, sku, type, display_name) VALUES (other, 'pro-foreign', 'subscription', 'X');

  base := jsonb_build_array(
    jsonb_build_object('key', 'control', 'weight', 50, 'offering_id', o1),
    jsonb_build_object('key', 'monthly-first', 'weight', 50, 'offering_id', o2));

  -- 1. A sku the variant's offering doesn't sell is refused: unknown, another offering's, inactive, another tenant's,
  --    not a string.
  FOR r IN SELECT * FROM (VALUES
    (jsonb_set(base, '{1,default_sku}', '"nope"')),
    (jsonb_set(base, '{1,default_sku}', '"pro-quarterly"')),
    (jsonb_set(base, '{0,default_sku}', '"pro-retired"')),
    (jsonb_set(base, '{0,default_sku}', '"pro-foreign"')),
    (jsonb_set(base, '{0,default_sku}', '7'))
  ) AS c(v) LOOP
    expect_error := NULL;
    BEGIN
      PERFORM paywall_experiment_save(t, 'default-plan', '', r.v);
    EXCEPTION WHEN OTHERS THEN expect_error := SQLERRM;
    END;
    IF expect_error IS DISTINCT FROM 'experiment_default_sku_unknown' THEN
      RAISE EXCEPTION 'FAIL: % → expected experiment_default_sku_unknown, got %', r.v, expect_error;
    END IF;
  END LOOP;

  -- 2. Absent / null / "" mean the paywall default and save as before.
  PERFORM paywall_experiment_save(t, 'default-plan', '', jsonb_set(base, '{0,default_sku}', 'null'));
  PERFORM paywall_experiment_save(t, 'default-plan', '', jsonb_set(base, '{0,default_sku}', '""'));

  -- 3. A sku the offering sells saves and is served on that variant only.
  PERFORM paywall_experiment_save(t, 'default-plan', '',
    jsonb_set(jsonb_set(base, '{0,default_sku}', '"pro-quarterly"'), '{1,default_sku}', '"pro-monthly-b"'));
  PERFORM paywall_experiment_save(t, 'default-plan', '', jsonb_set(base, '{1,default_sku}', '"pro-monthly-b"'));
  PERFORM paywall_experiment_set_status(t, 'default-plan', 'running');
  served := paywall_experiment_public_get(t);
  IF served->'variants'->1->>'default_sku' IS DISTINCT FROM 'pro-monthly-b' THEN
    RAISE EXCEPTION 'FAIL: default_sku not served: %', served;
  END IF;
  IF served->'variants'->0 ? 'default_sku' THEN
    RAISE EXCEPTION 'FAIL: a variant without default_sku carries the key: %', served;
  END IF;
  IF served->'variants'->0 <> jsonb_build_object('key', 'control', 'weight', 50, 'offering_id', o1::text) THEN
    RAISE EXCEPTION 'FAIL: 206 shape changed: %', served;
  END IF;

  RAISE NOTICE 'PASS 221 experiment default plan';
END $$;
ROLLBACK;
