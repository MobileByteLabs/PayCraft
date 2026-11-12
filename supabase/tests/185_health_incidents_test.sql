-- Assertions for migration 185 (health incidents open once, resolve once).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/185_health_incidents_test.sql
BEGIN;
DO $$
DECLARE opened TIMESTAMPTZ;
BEGIN
  IF health_incident_open('t185', 'first') IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: first failure must open'; END IF;
  IF health_incident_open('t185', 'second') IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: repeat failure must not re-open (one email)'; END IF;
  IF (SELECT last_detail FROM health_incidents WHERE check_name = 't185' AND resolved_at IS NULL) <> 'second' THEN
    RAISE EXCEPTION 'FAIL: repeat failure must refresh last_detail'; END IF;
  opened := health_incident_resolve('t185');
  IF opened IS NULL THEN RAISE EXCEPTION 'FAIL: recovery must close the open incident'; END IF;
  IF health_incident_resolve('t185') IS NOT NULL THEN RAISE EXCEPTION 'FAIL: a second recovery must be a no-op'; END IF;
  IF health_incident_open('t185', 'again') IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: a new outage must open a new incident'; END IF;
  IF (SELECT count(*) FROM health_incidents WHERE check_name = 't185') <> 2 THEN RAISE EXCEPTION 'FAIL: history must be kept'; END IF;
  IF has_function_privilege('anon', 'public.health_incident_open(text,text)', 'execute') THEN
    RAISE EXCEPTION 'FAIL: anon must not open incidents'; END IF;
  RAISE NOTICE 'ALL 7 assertions passed';
END $$;
ROLLBACK;
