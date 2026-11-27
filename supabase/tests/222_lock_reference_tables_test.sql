-- Assertions for migration 222: the public key can read PayCraft's reference tables but not write them, and nobody
-- can bulk-delete ticket votes.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/222_lock_reference_tables_test.sql
BEGIN;
DO $$
DECLARE t text; n int;
BEGIN
  FOREACH t IN ARRAY ARRAY['tier_definitions', 'pricing_bands', 'provider_method_registry'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'FAIL 1: % has RLS off', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'INSERT') OR has_table_privilege('anon', 'public.' || t, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || t, 'DELETE')
       OR has_table_privilege('authenticated', 'public.' || t, 'UPDATE') THEN
      RAISE EXCEPTION 'FAIL 2: the public key can still write %', t;
    END IF;
    IF NOT has_table_privilege('anon', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'FAIL 3: % is no longer readable — /config, pricing and the dashboard read it', t;
    END IF;
  END LOOP;
  RAISE NOTICE 'ok 1-3 - reference tables: RLS on, readable, not writable by anon/authenticated';

  -- Reads still return rows through the policy, as the anon role.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO n FROM public.tier_definitions;
  RESET ROLE;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL 4: anon reads no tier_definitions rows through RLS'; END IF;
  RAISE NOTICE 'ok 4 - anon still reads tier_definitions (% rows)', n;

  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ticket_votes' AND cmd = 'DELETE' AND qual = 'true') THEN
    RAISE EXCEPTION 'FAIL 5: ticket_votes still lets anyone delete every vote';
  END IF;
  RAISE NOTICE 'ok 5 - no open delete policy on ticket_votes';

  RAISE NOTICE 'PASS 222_lock_reference_tables: 5/5 ok';
END $$;
ROLLBACK;
