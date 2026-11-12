-- Assertions for migration 190 (GA4 stream filter on the tenant's connection).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/190_ga4_streams_test.sql
BEGIN;
DO $$
DECLARE t UUID; u UUID := gen_random_uuid(); r tenant_ga4_connections;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('ga4-190','g190@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO t;
  INSERT INTO auth.users (id, email) VALUES (u, 'g190@test.local');
  INSERT INTO tenant_admins (tenant_id, user_id) VALUES (t, u);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u)::text, true);

  -- 1. Old callers (no streams) still work and read the whole property.
  r := tenant_ga4_connection_save(t, '473327398', true, NULL);
  IF r.stream_ids <> '{}' THEN RAISE EXCEPTION 'FAIL: default streams must be empty'; END IF;

  -- 2. Streams are stored, and re-saving replaces them.
  r := tenant_ga4_connection_save(t, '473327398', true, NULL, ARRAY['10231617924', '13221627257']);
  IF r.stream_ids <> ARRAY['10231617924', '13221627257'] THEN RAISE EXCEPTION 'FAIL: streams not saved: %', r.stream_ids; END IF;
  r := tenant_ga4_connection_save(t, '473327398', true, NULL, ARRAY['13221627257']);
  IF r.stream_ids <> ARRAY['13221627257'] THEN RAISE EXCEPTION 'FAIL: streams not replaced'; END IF;

  -- 3. A measurement id (G-…) is not a stream id.
  BEGIN
    PERFORM tenant_ga4_connection_save(t, '473327398', true, NULL, ARRAY['G-JKWQF4SRN4']);
    RAISE EXCEPTION 'FAIL: measurement id accepted as a stream id';
  EXCEPTION WHEN check_violation THEN NULL; END;

  RAISE NOTICE 'PASS: 190 GA4 streams (default empty, saved, replaced, measurement ids refused)';
END $$;
ROLLBACK;
