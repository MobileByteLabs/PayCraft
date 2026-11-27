-- Assertions for migration 220: a buyer switching plans (sdk / flow_switch) is not a failure, so it never feeds
-- the failure-rate spike — while real failures still do.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/220_flow_switch_not_failure_test.sql
BEGIN;
DO $$
BEGIN
  IF public.attempt_event_is_failure('paycraft_attempt_abandon', 'flow_switch') THEN
    RAISE EXCEPTION 'FAIL 1: a plan switch counted as a failure';
  END IF;
  RAISE NOTICE 'ok 1 - flow_switch is not a failure';

  IF NOT public.attempt_event_is_failure('paycraft_purchase_fail', 'store_purchase') THEN
    RAISE EXCEPTION 'FAIL 2: a store failure stopped counting';
  END IF;
  IF public.attempt_event_is_failure('abandoned', 'store_purchase') THEN
    RAISE EXCEPTION 'FAIL 2: an abandon counted as a failure';
  END IF;
  RAISE NOTICE 'ok 2 - real failures still count, abandons still do not';

  RAISE NOTICE 'PASS 220_flow_switch_not_failure: 2/2 groups ok';
END $$;
ROLLBACK;
