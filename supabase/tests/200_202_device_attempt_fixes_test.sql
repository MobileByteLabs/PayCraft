-- Assertions for migrations 200 (reuse a device's pending row), 201 (store attempt reason), 202 (untenanted
-- Reels Downloader rows assigned to that app).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/200_202_device_attempt_fixes_test.sql
BEGIN;
DO $$
DECLARE t UUID; kl TEXT; a JSONB; b JSONB; n INT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, max_active_devices)
  VALUES ('fixes-200','f200@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w', 1)
  RETURNING id, api_key_live INTO t, kl;

  -- 200. Phone A takes the one seat; phone B conflicts; B asking again gets the SAME pending token, not a new row.
  PERFORM register_device('m@x.test', 'android', 'Phone A', 'dev-a', 'live', kl);
  a := register_device('m@x.test', 'android', 'Phone B', 'dev-b', 'live', kl);
  IF (a->>'conflict')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: second phone past the limit must conflict'; END IF;
  b := register_device('m@x.test', 'android', 'Phone B', 'dev-b', 'live', kl);
  IF b->>'server_token' <> a->>'server_token' THEN RAISE EXCEPTION 'FAIL: repeat attempt minted a new pending token'; END IF;
  SELECT count(*) INTO n FROM registered_devices WHERE tenant_id = t AND device_name = 'Phone B';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: expected 1 pending row for Phone B, got %', n; END IF;

  -- 201. The 7-arg report stores a sanitised reason; the 6-arg report (older SDKs) still works with none.
  IF record_store_attempt(kl, 'u-201', 'google_play', 'pro-monthly', 'payment_failed', 'att-201', 'Purchase_6 <x>') IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL: 7-arg attempt not recorded'; END IF;
  IF (SELECT failure_reason FROM checkout_attempts WHERE provider_session_id = 'att-201') <> 'purchase_6x' THEN
    RAISE EXCEPTION 'FAIL: reason not sanitised/stored'; END IF;
  PERFORM record_store_attempt(kl, 'u-201b', 'google_play', 'pro-monthly', 'abandoned', 'att-201b');
  IF (SELECT failure_reason FROM checkout_attempts WHERE provider_session_id = 'att-201b') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: 6-arg attempt must carry no reason'; END IF;
  IF NOT has_function_privilege('anon', 'public.record_store_attempt(text,text,text,text,text,text,text)', 'execute') THEN
    RAISE EXCEPTION 'FAIL: the SDK (anon) must be able to send a reason'; END IF;
  RAISE NOTICE '200/201: 7 assertions passed';
END $$;

-- 202. Seed the Reels Downloader tenant (absent locally) with one person who has a tenanted and an untenanted row,
-- and one person whose untenanted row also signs in elsewhere: only the first moves.
INSERT INTO tenants (id, name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
VALUES ('bba1842f-3a57-41cd-8705-94db588de056', 'Reels Downloader (test)', 'rd@test.local', 'pk_test_rd202', 'pk_live_rd202', 'w', 'w')
ON CONFLICT (id) DO NOTHING;
INSERT INTO registered_devices (email, platform, device_name, device_token, mode, tenant_id, is_active) VALUES
  ('rd-only@x.test', 'android', 'P1', 'tok-202-a', 'live', 'bba1842f-3a57-41cd-8705-94db588de056', true),
  ('rd-only@x.test', 'android', 'P1', 'tok-202-b', 'live', NULL, true),
  ('both@x.test',    'android', 'P2', 'tok-202-c', 'live', 'bba1842f-3a57-41cd-8705-94db588de056', true),
  ('both@x.test',    'android', 'P2', 'tok-202-d', 'live', '00000000-0000-0000-0000-000000000001', true),
  ('both@x.test',    'android', 'P2', 'tok-202-e', 'live', NULL, true);
\i supabase/migrations/202_reels_downloader_untenanted_devices.sql
\i supabase/migrations/202_reels_downloader_untenanted_devices.sql
DO $$
BEGIN
  IF (SELECT tenant_id FROM registered_devices WHERE device_token = 'tok-202-b') IS DISTINCT FROM 'bba1842f-3a57-41cd-8705-94db588de056' THEN
    RAISE EXCEPTION 'FAIL: a Reels-Downloader-only row was not assigned'; END IF;
  IF (SELECT tenant_id FROM registered_devices WHERE device_token = 'tok-202-e') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: a row whose person uses another app must not be guessed'; END IF;
  RAISE NOTICE '202: 2 assertions passed (and a second run was a no-op)';
END $$;
ROLLBACK;
