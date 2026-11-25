-- Assertions for migration 216 (paycraft-ga4-analytics-audit sub-plan 04): analytics_findings — what the weekly
-- digest and /idea-paycraft-analytics found, the queue the AI audit panel shows and the command drains.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/216_analytics_findings_test.sql
BEGIN;
DO $$
DECLARE
  t      UUID;
  other  UUID;
  admin  UUID := gen_random_uuid();
  f1     UUID;
  f2     UUID;
  n      INT;
  r      RECORD;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t216', 'o216@x.test', 'pk_test_216a', 'pk_live_216a', 'whsec_t216a', 'whsec_l216a') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('o216', 'p216@x.test', 'pk_test_216b', 'pk_live_216b', 'whsec_t216b', 'whsec_l216b') RETURNING id INTO other;
  INSERT INTO auth.users (id, email) VALUES (admin, 'admin216@x.test');
  INSERT INTO tenant_admins (tenant_id, user_id) VALUES (t, admin);

  -- 1. a finding is recorded once per (tenant, kind, window) — a re-run of the digest updates it, never duplicates
  f1 := public.analytics_finding_upsert(t, 'product_not_found', 'critical', '40 buyers could not buy',
          'Play answered OK with no product', '{"failed":69}'::jsonb, 'Check the install source', 'digest',
          date '2026-11-18', date '2026-11-25');
  f2 := public.analytics_finding_upsert(t, 'product_not_found', 'critical', '41 buyers could not buy',
          'Play answered OK with no product', '{"failed":70}'::jsonb, 'Check the install source', 'command',
          date '2026-11-18', date '2026-11-25');
  SELECT count(*) INTO n FROM analytics_findings WHERE tenant_id = t;
  IF f1 <> f2 OR n <> 1 THEN RAISE EXCEPTION 'FAIL 1: % rows, ids % / %', n, f1, f2; END IF;
  SELECT title, (evidence->>'failed')::int AS failed INTO r FROM analytics_findings WHERE id = f1;
  IF r.title <> '41 buyers could not buy' OR r.failed <> 70 THEN RAISE EXCEPTION 'FAIL 1b: not updated (%)', r; END IF;
  RAISE NOTICE 'ok 1 - one finding per tenant/kind/window, refreshed on re-run';

  -- 2. resolving records what was done, and a resolved finding is not reopened by the next upsert
  PERFORM public.analytics_finding_resolve(t, f1, 'fixed', 'SDK reports not_from_play (source 063638c)');
  PERFORM public.analytics_finding_upsert(t, 'product_not_found', 'critical', 'again', 's', '{}'::jsonb, 'x', 'digest',
          date '2026-11-18', date '2026-11-25');
  SELECT status, fixed_note, fixed_at IS NOT NULL AS stamped INTO r FROM analytics_findings WHERE id = f1;
  IF r.status <> 'fixed' OR r.fixed_note NOT LIKE 'SDK reports%' OR NOT r.stamped THEN RAISE EXCEPTION 'FAIL 2: %', r; END IF;
  RAISE NOTICE 'ok 2 - resolve stamps status + note; a re-run does not reopen it';

  -- 3. only open | fixed | dismissed, and severity is a closed set
  BEGIN
    PERFORM public.analytics_finding_resolve(t, f1, 'done', 'x');
    RAISE EXCEPTION 'FAIL 3: accepted status done';
  EXCEPTION WHEN check_violation OR invalid_parameter_value THEN
    RAISE NOTICE 'ok 3 - status is a closed set';
  END;

  -- 4. members read their own tenant's findings; another tenant's member reads none; anon reads none
  INSERT INTO analytics_findings (tenant_id, kind, severity, title, source, window_start, window_end)
  VALUES (other, 'x', 'low', 'other tenant', 'digest', date '2026-11-18', date '2026-11-25');
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub', admin)::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO n FROM analytics_findings;
  RESET ROLE;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4: member saw % rows', n; END IF;
  -- anon holds no grant at all: the read is refused outright, not answered with zero rows.
  BEGIN
    SET LOCAL ROLE anon;
    SELECT count(*) INTO n FROM analytics_findings;
    RESET ROLE;
    RAISE EXCEPTION 'FAIL 4b: anon read % rows', n;
  EXCEPTION WHEN insufficient_privilege THEN
    RESET ROLE;
  END;
  RAISE NOTICE 'ok 4 - RLS: members see their tenant only, anon refused';

  -- 5. a finding resolves only under its own tenant — another tenant's id changes nothing and says so
  IF public.analytics_finding_resolve(other, f1, 'dismissed', 'not mine') THEN
    RAISE EXCEPTION 'FAIL 5: another tenant resolved the finding';
  END IF;
  SELECT status INTO r FROM analytics_findings WHERE id = f1;
  IF r.status <> 'fixed' THEN RAISE EXCEPTION 'FAIL 5b: status changed to %', r.status; END IF;
  RAISE NOTICE 'ok 5 - resolve is tenant-scoped';

  -- 6. API keys may carry the analytics:write scope the command uses to record and resolve findings
  SELECT count(*) INTO n FROM pg_constraint WHERE conname = 'tenant_api_keys_scopes_known'
     AND pg_get_constraintdef(oid) LIKE '%analytics:write%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 6: analytics:write not an allowed scope'; END IF;
  RAISE NOTICE 'ok 6 - analytics:write is a known API scope';

  RAISE NOTICE 'PASS 216_analytics_findings: 6/6 groups ok';
END $$;
ROLLBACK;
