-- Assertions for migration 212 (weekly AI insights: budget + model knobs, the insights ledger, the atomic budget
-- reservation, the aggregates, the attempts-with-country view, retention, and the 211 schedule now dispatching).
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/212_attempt_insights_test.sql
--
-- Ten numbered groups; each RAISEs 'FAIL n: …' on the first broken expectation and prints 'ok n - …' when it
-- holds. Before 212 every group fails (the columns, table, view and functions it probes do not exist). Runs in
-- one transaction and rolls back, so it leaves nothing behind.
BEGIN;
DO $$
DECLARE
  t        UUID;
  other    UUID;
  admin    UUID := gen_random_uuid();
  now0     TIMESTAMPTZ := '2026-11-23T09:00:00Z';          -- Monday 09:00 UTC, when 211's job fires
  wk       DATE := '2026-11-16';                            -- the ISO week it summarises (W47)
  since0   TIMESTAMPTZ := '2026-11-16T00:00:00Z';
  until0   TIMESTAMPTZ := '2026-11-23T00:00:00Z';
  r        JSONB;
  agg      JSONB;
  id1      UUID;
  n        INT;
  s        TEXT;
  v        NUMERIC;
  cmd      TEXT;
  service  CONSTANT TEXT := '{"role":"service_role"}';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, plan)
  VALUES ('e2e_212', 'owner212@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w', 'free')
  RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('e2e_212_other', 'other212@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w')
  RETURNING id INTO other;
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (t, admin, 'owner');

  -- 1. Tenant knobs: declared defaults, a negative budget and an unpriceable model are refused.
  IF (SELECT ai_insights_budget_usd FROM tenants WHERE id = t) <> 1.00 THEN
    RAISE EXCEPTION 'FAIL 1: ai_insights_budget_usd default is not 1.00'; END IF;
  IF (SELECT ai_insights_model FROM tenants WHERE id = t) <> 'claude-sonnet-5-5' THEN
    RAISE EXCEPTION 'FAIL 1: ai_insights_model default is not claude-sonnet-5-5'; END IF;
  SELECT data_type INTO s FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'ai_insights_budget_usd';
  IF s <> 'numeric' THEN RAISE EXCEPTION 'FAIL 1: budget is % (money must be numeric)', s; END IF;
  BEGIN
    UPDATE tenants SET ai_insights_budget_usd = -1 WHERE id = t;
    RAISE EXCEPTION 'FAIL 1: negative budget accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE tenants SET ai_insights_model = 'gpt-whatever' WHERE id = t;
    RAISE EXCEPTION 'FAIL 1: an unpriceable model accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok 1 - budget NUMERIC default 1.00, model default claude-sonnet-5-5, both constrained';

  -- 2. attempt_insights: UNIQUE (tenant, week_start); week_start must be a Monday; a stored row needs a summary.
  INSERT INTO attempt_insights (tenant_id, week_start, status, summary, model) VALUES (other, '2026-11-09', 'stored', 'first', 'claude-sonnet-5-5');
  BEGIN
    INSERT INTO attempt_insights (tenant_id, week_start, status, summary, model) VALUES (other, '2026-11-09', 'stored', 'dup', 'claude-sonnet-5-5');
    RAISE EXCEPTION 'FAIL 2: duplicate (tenant, week_start) accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO attempt_insights (tenant_id, week_start, status, summary, model) VALUES (other, '2026-11-10', 'stored', 'tue', 'claude-sonnet-5-5');
    RAISE EXCEPTION 'FAIL 2: a non-Monday week_start accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO attempt_insights (tenant_id, week_start, status, model) VALUES (other, '2026-11-02', 'stored', 'claude-sonnet-5-5');
    RAISE EXCEPTION 'FAIL 2: a stored row without a summary accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'ok 2 - one row per tenant per Monday-started week; stored rows carry a summary';

  -- Seed week W47 for tenant t: 5 live attempts (2 granted, 1 failed provider/IN, 1 paid_not_granted, 1 abandoned
  -- with a nudge scheduled) + 1 test-mode and 1 out-of-window attempt that must not count.
  INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, email, plan, outcome, provider_session_id, attempt_id, state, correlation, occurred_at, error_code, stage)
  VALUES
    (t, 'stripe',   'live', 'u1', 'buyer1@x.test', 'pro-monthly', 'abandoned',      'cs_212_1', 'att-212-1', 'granted',          'exact', '2026-11-17T10:00:00Z', NULL, NULL),
    (t, 'razorpay', 'live', 'u2', 'buyer2@x.test', 'pro-monthly', 'abandoned',      'cs_212_2', 'att-212-2', 'granted',          'exact', '2026-11-18T10:00:00Z', NULL, NULL),
    (t, 'stripe',   'live', 'u3', 'buyer3@x.test', 'pro-monthly', 'payment_failed', 'cs_212_3', 'att-212-3', 'failed',           'exact', '2026-11-19T10:00:00Z', 'card_declined', 'provider'),
    (t, 'stripe',   'live', 'u4', 'buyer4@x.test', 'pro-monthly', 'abandoned',      'cs_212_4', 'att-212-4', 'paid_not_granted', 'exact', '2026-11-20T10:00:00Z', 'grant_timeout', 'entitlement'),
    (t, 'stripe',   'live', 'u5', 'buyer5@x.test', 'pro-monthly', 'abandoned',      'cs_212_5', 'att-212-5', 'abandoned',        'exact', '2026-11-21T10:00:00Z', NULL, 'sdk'),
    (t, 'stripe',   'test', 'u6', 'buyer6@x.test', 'pro-monthly', 'payment_failed', 'cs_212_6', 'att-212-6', 'failed',           'exact', '2026-11-19T11:00:00Z', 'card_declined', 'provider'),
    (t, 'stripe',   'live', 'u7', 'buyer7@x.test', 'pro-monthly', 'payment_failed', 'cs_212_7', 'att-212-7', 'failed',           'exact', '2026-11-10T11:00:00Z', 'card_declined', 'provider');
  INSERT INTO paywall_events (tenant_id, user_ref, device_ref, name, step, platform, country, mode, occurred_at, attempt_id)
  VALUES (t, 'h3', 'd3', 'paycraft_checkout_start', 'checkout', 'android', 'IN', 'live', '2026-11-19T09:59:00Z', 'att-212-3'),
         (t, 'h1', 'd1', 'paycraft_checkout_start', 'checkout', 'android', 'US', 'live', '2026-11-17T09:59:00Z', 'att-212-1');
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_code, occurred_at)
  VALUES ('att-212-5', t, 'sdk', 'paycraft_nudge_scheduled', NULL, '2026-11-21T10:05:00Z'),
         ('att-212-2', t, 'sdk', 'paycraft_nudge_skipped', 'skipped_no_permission', '2026-11-18T10:05:00Z');

  -- 3. payment_attempts_geo carries the attempt's country from its paywall event, NULL when it has none.
  IF (SELECT country FROM payment_attempts_geo WHERE attempt_id = 'att-212-3') IS DISTINCT FROM 'IN'
     OR (SELECT country FROM payment_attempts_geo WHERE attempt_id = 'att-212-2') IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 3: payment_attempts_geo country is wrong'; END IF;
  RAISE NOTICE 'ok 3 - payment_attempts_geo joins the attempt''s country';

  -- 4. Service-role only: the budget / aggregate functions refuse any other caller.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM attempt_insights_reserve(t, wk, 'claude-sonnet-5-5', 0.01, now0);
    RAISE EXCEPTION 'FAIL 4: reserve ran for an authenticated member';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM attempt_insights_aggregate(t, since0, until0);
    RAISE EXCEPTION 'FAIL 4: aggregate ran for an authenticated member';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', service, true);
  RAISE NOTICE 'ok 4 - reserve / aggregate are service-role only';

  -- 5. The aggregate: live, in-window counts only, by stage / provider / country, top codes, nudge reach — and no
  --    buyer identity anywhere in it.
  agg := attempt_insights_aggregate(t, since0, until0);
  IF (agg->>'total')::int <> 5 OR (agg->>'granted')::int <> 2 OR (agg->>'failed')::int <> 1
     OR (agg->>'paid_not_granted')::int <> 1 OR (agg->>'abandoned')::int <> 1 OR (agg->>'open')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL 5: totals wrong: %', agg; END IF;
  IF agg->'failures_by_stage' <> '{"provider": 1, "entitlement": 1}'::jsonb THEN
    RAISE EXCEPTION 'FAIL 5: failures_by_stage %', agg->'failures_by_stage'; END IF;
  IF agg->'by_provider'->'stripe' <> '{"total": 4, "failed": 2}'::jsonb
     OR agg->'by_country'->'IN' <> '{"total": 1, "failed": 1}'::jsonb
     OR agg->'by_country'->'unknown' <> '{"total": 3, "failed": 1}'::jsonb THEN
    RAISE EXCEPTION 'FAIL 5: provider / country buckets %', agg; END IF;
  IF jsonb_array_length(agg->'top_failure_codes') <> 2
     OR (agg->'top_failure_codes'->0->>'count')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 5: top_failure_codes %', agg->'top_failure_codes'; END IF;
  IF (agg->>'nudge_scheduled')::int <> 1 OR (agg->>'nudge_skipped_no_permission')::int <> 1 THEN
    RAISE EXCEPTION 'FAIL 5: nudge counts %', agg; END IF;
  IF agg::text ~* '(buyer[0-9]@|user_ref|"u[0-9]"|cs_212_|"h[0-9]")' THEN
    RAISE EXCEPTION 'FAIL 5: the aggregate carries buyer identity: %', agg; END IF;
  IF (attempt_insights_aggregate(other, since0, until0)->>'total')::int <> 0 THEN
    RAISE EXCEPTION 'FAIL 5: another tenant''s aggregate counts tenant t''s attempts'; END IF;
  RAISE NOTICE 'ok 5 - aggregate: live in-window counts, buckets, codes, nudge reach; no buyer identity';

  -- 6. attempt_insights_due lists t (budget > 0, live attempts in the week, nothing recorded) and not `other`
  --    (no attempts); a zero budget takes t out.
  SELECT count(*) INTO n FROM attempt_insights_due(wk, since0, until0) d WHERE d.tenant_id = t;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 6: t not due'; END IF;
  SELECT count(*) INTO n FROM attempt_insights_due(wk, since0, until0) d WHERE d.tenant_id = other;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6: an idle tenant is due'; END IF;
  UPDATE tenants SET ai_insights_budget_usd = 0 WHERE id = t;
  SELECT count(*) INTO n FROM attempt_insights_due(wk, since0, until0) d WHERE d.tenant_id = t;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL 6: a zero-budget tenant is due'; END IF;
  UPDATE tenants SET ai_insights_budget_usd = 1.00 WHERE id = t;
  RAISE NOTICE 'ok 6 - due = budget > 0 AND live attempts in the week AND nothing recorded';

  -- 7. Reserve: a reservation that would cross the month's budget is refused; one that fits holds the worst case;
  --    the same week cannot be reserved twice; complete swaps in the real cost; month spend sums it.
  INSERT INTO attempt_insights (tenant_id, week_start, status, summary, model, cost_usd, created_at)
  VALUES (t, '2026-11-02', 'stored', 'earlier this month', 'claude-sonnet-5-5', 0.95, '2026-11-03T09:00:00Z');
  r := attempt_insights_reserve(t, wk, 'claude-sonnet-5-5', 0.10, now0);
  IF r->>'reason' IS DISTINCT FROM 'budget_exhausted' OR (r->>'spent_usd')::numeric <> 0.95 THEN
    RAISE EXCEPTION 'FAIL 7: 0.95 + 0.10 > 1.00 was not refused: %', r; END IF;
  r := attempt_insights_reserve(t, wk, 'claude-sonnet-5-5', 0.05, now0);
  id1 := (r->>'id')::uuid;
  IF id1 IS NULL THEN RAISE EXCEPTION 'FAIL 7: 0.95 + 0.05 <= 1.00 was refused: %', r; END IF;
  IF attempt_insights_month_spend_usd(t, now0) <> 1.00 THEN
    RAISE EXCEPTION 'FAIL 7: the reservation does not hold budget'; END IF;
  r := attempt_insights_reserve(t, wk, 'claude-sonnet-5-5', 0.00, now0);
  IF r->>'reason' IS DISTINCT FROM 'already_recorded' THEN RAISE EXCEPTION 'FAIL 7: week reserved twice: %', r; END IF;
  IF NOT attempt_insights_complete(id1, 'stored', 'Stripe failures concentrated in IN.', '["Enable 3DS"]'::jsonb, agg,
                                   'claude-sonnet-5-5', 900, 400, 0.0058, now0) THEN
    RAISE EXCEPTION 'FAIL 7: complete did not find the reservation'; END IF;
  SELECT cost_usd INTO v FROM attempt_insights WHERE id = id1;
  IF v <> 0.0058 OR attempt_insights_month_spend_usd(t, now0) <> 0.9558 THEN
    RAISE EXCEPTION 'FAIL 7: real cost not recorded (% / %)', v, attempt_insights_month_spend_usd(t, now0); END IF;
  IF attempt_insights_complete(id1, 'stored', 'again', '[]'::jsonb, '{}'::jsonb, 'x', 1, 1, 9, now0) THEN
    RAISE EXCEPTION 'FAIL 7: a completed row was rewritten'; END IF;
  -- The next calendar month starts from zero.
  IF attempt_insights_month_spend_usd(t, '2026-12-01T00:00:00Z') <> 0 THEN
    RAISE EXCEPTION 'FAIL 7: spend leaks across months'; END IF;
  RAISE NOTICE 'ok 7 - reserve refuses over-budget, holds worst case, once per week; complete records the real cost';

  -- 8. Release gives an unbilled reservation back; a stale reservation (crashed run) is reclaimed after 30 min.
  r := attempt_insights_reserve(t, '2026-11-09', 'claude-sonnet-5-5', 0.01, now0);
  IF NOT attempt_insights_release((r->>'id')::uuid) THEN RAISE EXCEPTION 'FAIL 8: release found nothing'; END IF;
  IF EXISTS (SELECT 1 FROM attempt_insights WHERE tenant_id = t AND week_start = '2026-11-09') THEN
    RAISE EXCEPTION 'FAIL 8: released reservation still on the ledger'; END IF;
  r := attempt_insights_reserve(t, '2026-11-09', 'claude-sonnet-5-5', 0.01, now0 - interval '2 hours');
  r := attempt_insights_reserve(t, '2026-11-09', 'claude-sonnet-5-5', 0.01, now0);
  IF r->>'id' IS NULL THEN RAISE EXCEPTION 'FAIL 8: a stale reservation blocked the week: %', r; END IF;
  RAISE NOTICE 'ok 8 - release frees an unbilled reservation; stale reservations are reclaimed';

  -- 9. Retention never purges the current calendar month (the budget ledger), only rows older than both it and
  --    the tier's retention.
  INSERT INTO attempt_insights (tenant_id, week_start, status, summary, model, cost_usd, created_at)
  VALUES (t, '2025-01-06', 'stored', 'ancient', 'claude-sonnet-5-5', 0.5, now() - interval '400 days'),
         (t, date_trunc('week', now())::date, 'stored', 'this month', 'claude-sonnet-5-5', 0.5,
          GREATEST(now() - interval '1 minute', date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))
  ON CONFLICT (tenant_id, week_start) DO NOTHING;
  PERFORM tier_retention_purge_insights();
  IF EXISTS (SELECT 1 FROM attempt_insights WHERE tenant_id = t AND summary = 'ancient') THEN
    RAISE EXCEPTION 'FAIL 9: a 400-day-old insight survived the purge'; END IF;
  IF NOT EXISTS (SELECT 1 FROM attempt_insights WHERE tenant_id = t
                  AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') THEN
    RAISE EXCEPTION 'FAIL 9: the purge removed this month''s budget ledger'; END IF;
  RAISE NOTICE 'ok 9 - retention follows the tier but keeps the current month';

  -- 10. 211's weekly job is the only insights schedule, and it now dispatches the edge function; the daily
  --     retention job also purges insights. Locally (no vault entries) the dispatch calls nothing.
  SELECT count(*) INTO n FROM cron.job WHERE jobname = 'paycraft_attempt_insights';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: paycraft_attempt_insights schedule count %', n; END IF;
  SELECT count(*) INTO n FROM cron.job WHERE command ILIKE '%attempt_insights_dispatch%' OR command ILIKE '%attempt-insights%';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 10: % schedules dispatch insights (must be exactly one)', n; END IF;
  SELECT command INTO cmd FROM cron.job WHERE jobname = 'paycraft_attempt_retention';
  IF cmd NOT ILIKE '%tier_retention_purge_insights%' THEN RAISE EXCEPTION 'FAIL 10: retention job misses insights'; END IF;
  IF pg_get_functiondef('public.attempt_insights_dispatch()'::regprocedure) NOT ILIKE '%paycraft_function_post(''attempt-insights'')%' THEN
    RAISE EXCEPTION 'FAIL 10: attempt_insights_dispatch does not call the attempt-insights function'; END IF;
  PERFORM attempt_insights_dispatch();
  RAISE NOTICE 'ok 10 - one weekly schedule dispatching attempt-insights; retention covers insights';

  -- RLS: a member reads their own tenant's insights only, and cannot write any.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO n FROM attempt_insights WHERE tenant_id = other;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL RLS: member sees % insight(s) of another tenant', n; END IF;
  SELECT count(*) INTO n FROM attempt_insights WHERE tenant_id = t;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL RLS: member cannot see own insights'; END IF;
  BEGIN
    UPDATE attempt_insights SET summary = 'tampered' WHERE tenant_id = t;
    RAISE EXCEPTION 'FAIL RLS: member rewrote an insight';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT count(*) INTO n FROM payment_attempts_geo WHERE tenant_id = t;
  IF n = 0 THEN RAISE EXCEPTION 'FAIL RLS: member cannot read own attempts through payment_attempts_geo'; END IF;
  SELECT count(*) INTO n FROM payment_attempts_geo WHERE tenant_id = other;
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL RLS: payment_attempts_geo leaks another tenant'; END IF;
  PERFORM set_config('role', 'postgres', true);

  RAISE NOTICE 'PASS 212_attempt_insights_test: 10/10 groups ok (+ RLS isolation)';
END $$;
ROLLBACK;
