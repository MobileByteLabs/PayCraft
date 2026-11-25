-- Assertions for migration 218: the alert destinations carry the app's name, still service-role only.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/218_alert_targets_app_name_test.sql
BEGIN;
DO $$
DECLARE
  t   UUID;
  app TEXT;
  ok  BOOLEAN := FALSE;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('Reels Downloader', 'o218@x.test', 'pk_test_218', 'pk_live_218', 'whsec_t218', 'whsec_l218') RETURNING id INTO t;

  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT d.app_name INTO app FROM tenant_alert_channels_decrypt(t) d;
  IF app IS DISTINCT FROM 'Reels Downloader' THEN RAISE EXCEPTION 'FAIL 1: app_name = %', app; END IF;
  RAISE NOTICE 'ok 1 - destinations name the app';

  PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM * FROM tenant_alert_channels_decrypt(t);
  EXCEPTION WHEN insufficient_privilege THEN ok := TRUE;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FAIL 2: a non-service caller read the destinations'; END IF;
  RAISE NOTICE 'ok 2 - still service-role only';

  RAISE NOTICE 'PASS 218_alert_targets_app_name: 2/2 groups ok';
END $$;
ROLLBACK;
