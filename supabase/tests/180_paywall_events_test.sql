-- Assertions for migration 180 (paywall_events — the first-party paywall funnel).
--
--   supabase start
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/180_paywall_events_test.sql
--
-- Before 180 every assertion FAILS (the table does not exist); after it all pass.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant UUID;
  v_err    TEXT;
  v_purged INT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('events-180-fixture','events180@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;

  INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, sku, currency, country, provider, occurred_at)
  VALUES (v_tenant, 'dev-1', 'paycraft_checkout_start', 'checkout', 'android', 'pro-monthly', 'INR', 'IN', 'razorpay', now());
  INSERT INTO _t VALUES ('stores a catalog-shaped event',
    (SELECT count(*) FROM paywall_events WHERE tenant_id = v_tenant) = 1);

  BEGIN
    INSERT INTO paywall_events (tenant_id, name, step, platform, occurred_at) VALUES (v_tenant, 'paywall_view', 'paywall', 'android', now());
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('rejects a name without the paycraft_ prefix', v_err IS NOT NULL);

  BEGIN
    INSERT INTO paywall_events (tenant_id, name, step, platform, occurred_at) VALUES (v_tenant, 'paycraft_paywall_view', 'paywall', 'tv', now());
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('rejects an unknown platform', v_err IS NOT NULL);

  BEGIN
    INSERT INTO paywall_events (tenant_id, name, step, platform, country, occurred_at) VALUES (v_tenant, 'paycraft_paywall_view', 'paywall', 'web', 'ind', now());
    v_err := NULL;
  EXCEPTION WHEN check_violation THEN v_err := SQLERRM;
  END;
  INSERT INTO _t VALUES ('rejects a country that is not ISO alpha-2', v_err IS NOT NULL);

  -- Retention: the tenant's tier keeps analytics_retention_days; older rows are purged, fresh ones kept.
  INSERT INTO paywall_events (tenant_id, name, step, platform, occurred_at)
  VALUES (v_tenant, 'paycraft_paywall_view', 'paywall', 'ios', now() - interval '400 days');
  v_purged := paywall_events_purge();
  INSERT INTO _t VALUES ('purge removes events older than the tier retention', v_purged >= 1
    AND NOT EXISTS (SELECT 1 FROM paywall_events WHERE tenant_id = v_tenant AND occurred_at < now() - interval '399 days'));
  INSERT INTO _t VALUES ('purge keeps recent events',
    EXISTS (SELECT 1 FROM paywall_events WHERE tenant_id = v_tenant AND name = 'paycraft_checkout_start'));

  INSERT INTO _t VALUES ('row level security is on',
    (SELECT relrowsecurity FROM pg_class WHERE relname = 'paywall_events'));
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
