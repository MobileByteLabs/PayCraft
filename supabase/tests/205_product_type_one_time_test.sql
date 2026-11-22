-- Assertions for migration 205 (product_type accepts 'one_time', the API's own name for a one-time product).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/205_product_type_one_time_test.sql
BEGIN;
DO $$
DECLARE t UUID;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('onetime-205', 'o205@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w')
  RETURNING id INTO t;

  -- The exact write that answered 500 before: the upsert RPC casts p_row->>'type' to product_type.
  PERFORM _tenant_products_upsert_core(jsonb_build_object('tenant_id', t, 'sku', 'pro-lifetime', 'display_name', 'Lifetime',
    'type', 'one_time', 'base_price_cents', 399, 'base_currency', 'USD'));
  IF NOT EXISTS (SELECT 1 FROM tenant_products WHERE tenant_id = t AND sku = 'pro-lifetime' AND type::text = 'one_time') THEN
    RAISE EXCEPTION 'FAIL: a one_time product was not stored';
  END IF;

  -- 'lifetime' rows written before 205 still read back.
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type ty ON ty.oid = e.enumtypid WHERE ty.typname = 'product_type' AND e.enumlabel = 'lifetime') THEN
    RAISE EXCEPTION 'FAIL: the legacy lifetime value must remain';
  END IF;
  RAISE NOTICE 'PASS 205_product_type_one_time';
END $$;
ROLLBACK;
