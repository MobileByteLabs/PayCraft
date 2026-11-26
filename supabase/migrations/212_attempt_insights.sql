-- 212 — weekly AI insights over purchase attempts, under a per-tenant USD budget, plus the attempts-with-country
-- view the attempt MCP tools filter on (paycraft-attempt-observability GOAL D13 / D15, AC-17 / AC-18).
--
-- THE GAP
-- 210 records every attempt, 211 alerts on the critical ones; nobody summarises the week. 211 scheduled the
-- weekly job (`paycraft_attempt_insights`, Monday 09:00 UTC) against attempt_insights_dispatch(), a no-op that
-- this migration replaces with the real call. No second schedule is created.
--
-- WHAT THIS ADDS
--   · payment_attempts_geo — 210's payment_attempts plus the country the attempt was made from (the first
--     paywall_events row carrying it, stamped server-side by the `events` function). security_invoker, so a
--     dashboard member sees only their tenants; /v1/attempts filters `country` on it.
--   · tenants.ai_insights_budget_usd (NUMERIC, default 1.00 USD per calendar month, 0 = off) and
--     tenants.ai_insights_model (default claude-sonnet-5-5, one of the models the function can price).
--   · attempt_insights — one row per tenant per ISO week: the summary, its recommendations, the aggregates it was
--     written from (counts only — never a buyer), the tokens and the USD it cost, and the alert that carried it.
--   · The budget is enforced in the database, atomically: attempt_insights_reserve() takes a per-tenant advisory
--     lock, re-reads this month's spend and inserts a 'reserved' row holding the WORST-CASE cost before the model
--     is called; attempt_insights_complete() replaces it with the real cost. Two concurrent runs can therefore
--     never both spend the last of a budget, and the same week can never be paid for twice. A reservation left
--     behind by a crashed run is reclaimed after 30 minutes.
--   · attempt_insights_aggregate() — the week's numbers as one jsonb (live mode; counts, rates' inputs, top error
--     codes). It selects no user_ref, email, app_user_id or provider id.
--   · Retention: insights are aggregates (no PII) but follow the tier's analytics retention like 211's alerts —
--     never purging the current calendar month, whose rows ARE the budget ledger.
--
-- Idempotent: CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS /
-- ADD CONSTRAINT guarded by pg_constraint; cron.schedule replaces a job of the same name.

-- ── 1. Attempts with their country ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.payment_attempts_geo WITH (security_invoker = true) AS
SELECT p.id,
       p.tenant_id,
       p.attempt_id,
       p.provider,
       p.mode,
       p.plan,
       p.state,
       p.correlation,
       p.match_rule,
       p.stage,
       p.error_class,
       p.error_code,
       p.error_message,
       p.provider_session_id,
       p.provider_subscription_id,
       p.user_ref,
       p.started_at,
       p.paid_at,
       p.granted_at,
       p.closed_at,
       p.updated_at,
       c.country
FROM public.payment_attempts p
LEFT JOIN LATERAL (
  SELECT e.country
  FROM public.paywall_events e
  WHERE p.attempt_id IS NOT NULL
    AND e.attempt_id = p.attempt_id
    AND e.tenant_id = p.tenant_id
    AND e.country IS NOT NULL
  ORDER BY e.occurred_at
  LIMIT 1
) c ON TRUE;
GRANT SELECT ON public.payment_attempts_geo TO authenticated, service_role;

-- ── 2. Tenant knobs ───────────────────────────────────────────────────────────────────────────────────
-- NUMERIC for money: a float budget would drift by fractions of a cent per debit.
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ai_insights_budget_usd NUMERIC(10,4) NOT NULL DEFAULT 1.00;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ai_insights_model      TEXT          NOT NULL DEFAULT 'claude-sonnet-5-5';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_ai_insights_budget_nonneg') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_ai_insights_budget_nonneg
      CHECK (ai_insights_budget_usd >= 0 AND ai_insights_budget_usd <= 1000);
  END IF;
  -- Only models the attempt-insights function has a price for (supabase/functions/attempt-insights/engine.ts
  -- PRICES): a budget cannot be enforced in a currency the function cannot compute.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_ai_insights_model_known') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_ai_insights_model_known
      CHECK (ai_insights_model IN ('claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'));
  END IF;
END $$;

-- ── 3. The insights ledger ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attempt_insights (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID          NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  week_start      DATE          NOT NULL,                       -- Monday (UTC) of the ISO week summarised
  status          TEXT          NOT NULL DEFAULT 'reserved',
  summary         TEXT,                                         -- the model's narrative (NULL until stored)
  recommendations JSONB         NOT NULL DEFAULT '[]'::jsonb,
  aggregates      JSONB         NOT NULL DEFAULT '{}'::jsonb,   -- the counts the summary was written from
  model           TEXT          NOT NULL,                       -- requested model
  model_served    TEXT,                                         -- the model that answered (a fallback may)
  input_tokens    INT           NOT NULL DEFAULT 0,
  output_tokens   INT           NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10,4) NOT NULL DEFAULT 0,             -- reserved worst case, then the real cost
  alert_id        UUID          REFERENCES public.tenant_alerts(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  UNIQUE (tenant_id, week_start)
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attempt_insights_shape') THEN
    ALTER TABLE public.attempt_insights ADD CONSTRAINT attempt_insights_shape CHECK (
          status IN ('reserved', 'stored', 'refused')
      AND (status <> 'stored' OR (summary IS NOT NULL AND length(summary) BETWEEN 1 AND 4000))
      AND jsonb_typeof(recommendations) = 'array'
      AND jsonb_typeof(aggregates) = 'object'
      AND cost_usd >= 0 AND input_tokens >= 0 AND output_tokens >= 0
      AND extract(isodow FROM week_start) = 1);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_attempt_insights_tenant ON public.attempt_insights (tenant_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_attempt_insights_month  ON public.attempt_insights (tenant_id, created_at);

ALTER TABLE public.attempt_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attempt_insights_service_role ON public.attempt_insights;
CREATE POLICY attempt_insights_service_role ON public.attempt_insights FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
DROP POLICY IF EXISTS attempt_insights_admin_select ON public.attempt_insights;
CREATE POLICY attempt_insights_admin_select ON public.attempt_insights FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
-- Only the attempt-insights function (service_role) writes; a member may read their tenants' insights.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attempt_insights FROM anon, authenticated;

-- ── 4. Budget ledger ──────────────────────────────────────────────────────────────────────────────────
-- USD this tenant's insights cost (or hold in reservation) in the calendar month (UTC) containing p_at.
CREATE OR REPLACE FUNCTION public.attempt_insights_month_spend_usd(p_tenant_id UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(sum(i.cost_usd), 0)::numeric
  FROM attempt_insights i
  WHERE i.tenant_id = p_tenant_id
    AND i.created_at >= (date_trunc('month', p_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    AND i.created_at <  ((date_trunc('month', p_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC');
$$;
REVOKE ALL ON FUNCTION public.attempt_insights_month_spend_usd(UUID, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_month_spend_usd(UUID, TIMESTAMPTZ) TO service_role;

-- Reserve p_reserve_usd for (tenant, week) or say why not:
--   { "id": <uuid> }                                   reserved — call the model, then complete or release
--   { "id": null, "reason": "budget_exhausted", … }    this month's spend + the reservation would exceed budget
--   { "id": null, "reason": "already_recorded" }       this week has a row (stored, refused or in flight)
--   { "id": null, "reason": "tenant_not_found" }
CREATE OR REPLACE FUNCTION public.attempt_insights_reserve(
  p_tenant_id   UUID,
  p_week_start  DATE,
  p_model       TEXT,
  p_reserve_usd NUMERIC,
  p_now         TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_budget NUMERIC;
  v_spent  NUMERIC;
  v_id     UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_reserve_usd IS NULL OR p_reserve_usd < 0 THEN
    RAISE EXCEPTION 'reserve_invalid: %', p_reserve_usd USING ERRCODE = '22023';
  END IF;
  IF p_week_start IS NULL OR extract(isodow FROM p_week_start) <> 1 THEN
    RAISE EXCEPTION 'week_start_not_monday: %', p_week_start USING ERRCODE = '22023';
  END IF;
  -- One budget decision per tenant at a time: the spend read below and the insert are one critical section.
  PERFORM pg_advisory_xact_lock(hashtextextended('attempt_insights:' || p_tenant_id::text, 0));

  SELECT t.ai_insights_budget_usd INTO v_budget FROM tenants t WHERE t.id = p_tenant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('id', NULL, 'reason', 'tenant_not_found'); END IF;

  -- A reservation older than 30 minutes belongs to a run that died between reserving and completing; it held
  -- budget it never spent, so it is reclaimed rather than blocking the week forever.
  DELETE FROM attempt_insights
   WHERE tenant_id = p_tenant_id AND week_start = p_week_start AND status = 'reserved'
     AND created_at < p_now - interval '30 minutes';
  IF EXISTS (SELECT 1 FROM attempt_insights WHERE tenant_id = p_tenant_id AND week_start = p_week_start) THEN
    RETURN jsonb_build_object('id', NULL, 'reason', 'already_recorded');
  END IF;

  v_spent := attempt_insights_month_spend_usd(p_tenant_id, p_now);
  IF v_spent + p_reserve_usd > v_budget THEN
    RETURN jsonb_build_object('id', NULL, 'reason', 'budget_exhausted', 'spent_usd', v_spent, 'budget_usd', v_budget,
                              'needed_usd', p_reserve_usd);
  END IF;

  INSERT INTO attempt_insights (tenant_id, week_start, status, model, cost_usd, created_at)
  VALUES (p_tenant_id, p_week_start, 'reserved', p_model, p_reserve_usd, p_now)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'spent_usd', v_spent, 'budget_usd', v_budget);
END;
$$;
REVOKE ALL ON FUNCTION public.attempt_insights_reserve(UUID, DATE, TEXT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_reserve(UUID, DATE, TEXT, NUMERIC, TIMESTAMPTZ) TO service_role;

-- Replace a reservation with what actually happened: 'stored' (a summary) or 'refused' (the model declined; the
-- tokens were still billed, so the cost stays on the ledger). True when the reservation was found.
CREATE OR REPLACE FUNCTION public.attempt_insights_complete(
  p_id              UUID,
  p_status          TEXT,
  p_summary         TEXT,
  p_recommendations JSONB,
  p_aggregates      JSONB,
  p_model_served    TEXT,
  p_input_tokens    INT,
  p_output_tokens   INT,
  p_cost_usd        NUMERIC,
  p_now             TIMESTAMPTZ DEFAULT now()
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('stored', 'refused') THEN
    RAISE EXCEPTION 'status_invalid: %', p_status USING ERRCODE = '22023';
  END IF;
  UPDATE attempt_insights
     SET status          = p_status,
         summary         = CASE WHEN p_status = 'stored' THEN left(p_summary, 4000) END,
         recommendations = COALESCE(p_recommendations, '[]'::jsonb),
         aggregates      = COALESCE(p_aggregates, '{}'::jsonb),
         model_served    = p_model_served,
         input_tokens    = GREATEST(COALESCE(p_input_tokens, 0), 0),
         output_tokens   = GREATEST(COALESCE(p_output_tokens, 0), 0),
         cost_usd        = GREATEST(COALESCE(p_cost_usd, 0), 0),
         completed_at    = p_now
   WHERE id = p_id AND status = 'reserved';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.attempt_insights_complete(UUID, TEXT, TEXT, JSONB, JSONB, TEXT, INT, INT, NUMERIC, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_complete(UUID, TEXT, TEXT, JSONB, JSONB, TEXT, INT, INT, NUMERIC, TIMESTAMPTZ) TO service_role;

-- Give a reservation back when the model was never reached (network error, 5xx before any token): nothing was
-- billed, so nothing stays on the ledger and the week can be retried by the next run.
CREATE OR REPLACE FUNCTION public.attempt_insights_release(p_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM attempt_insights WHERE id = p_id AND status = 'reserved';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.attempt_insights_release(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_release(UUID) TO service_role;

-- Record which tenant_alerts row delivered a stored insight (NULL when deduped or the owner turned it off).
CREATE OR REPLACE FUNCTION public.attempt_insights_link_alert(p_id UUID, p_alert_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE attempt_insights SET alert_id = p_alert_id WHERE id = p_id AND status = 'stored';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.attempt_insights_link_alert(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_link_alert(UUID, UUID) TO service_role;

-- ── 5. What the week looked like ──────────────────────────────────────────────────────────────────────
-- Live-mode attempts that STARTED in [p_since, p_until). The definitions match dashboard/lib/payment-health.ts:
-- `failures` = failed + paid_not_granted; by_provider / by_country carry {total, failed} per key; the nudge
-- counts are resume reminders scheduled vs skipped for lack of notification permission. Counts only.
CREATE OR REPLACE FUNCTION public.attempt_insights_aggregate(p_tenant_id UUID, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  WITH a AS (
    SELECT g.attempt_id, g.state, g.stage, g.provider, g.country, g.error_code
    FROM payment_attempts_geo g
    WHERE g.tenant_id = p_tenant_id AND g.mode = 'live' AND g.started_at >= p_since AND g.started_at < p_until
  ), f AS (
    SELECT * FROM a WHERE a.state IN ('failed', 'paid_not_granted')
  ), n AS (
    SELECT count(*) FILTER (WHERE e.event = 'paycraft_nudge_scheduled') AS scheduled,
           count(*) FILTER (WHERE e.event = 'paycraft_nudge_skipped' AND e.error_code = 'skipped_no_permission') AS skipped
    FROM attempt_events e
    WHERE e.tenant_id = p_tenant_id
      AND e.event IN ('paycraft_nudge_scheduled', 'paycraft_nudge_skipped')
      AND e.attempt_id IN (SELECT a.attempt_id FROM a WHERE a.attempt_id IS NOT NULL)
  )
  SELECT jsonb_build_object(
    'total',            (SELECT count(*) FROM a),
    'granted',          (SELECT count(*) FROM a WHERE a.state = 'granted'),
    'failed',           (SELECT count(*) FROM a WHERE a.state = 'failed'),
    'paid_not_granted', (SELECT count(*) FROM a WHERE a.state = 'paid_not_granted'),
    'abandoned',        (SELECT count(*) FROM a WHERE a.state = 'abandoned'),
    'open',             (SELECT count(*) FROM a WHERE a.state IN ('started', 'checkout_opened', 'provider_result')),
    'failures_by_stage', COALESCE((SELECT jsonb_object_agg(s.k, s.c) FROM (
                            SELECT COALESCE(f.stage, 'unknown') AS k, count(*) AS c FROM f GROUP BY 1) s), '{}'::jsonb),
    'by_provider',      COALESCE((SELECT jsonb_object_agg(s.k, jsonb_build_object('total', s.t, 'failed', s.fl)) FROM (
                            SELECT COALESCE(a.provider, 'unknown') AS k, count(*) AS t,
                                   count(*) FILTER (WHERE a.state IN ('failed', 'paid_not_granted')) AS fl
                            FROM a GROUP BY 1) s), '{}'::jsonb),
    'by_country',       COALESCE((SELECT jsonb_object_agg(s.k, jsonb_build_object('total', s.t, 'failed', s.fl)) FROM (
                            SELECT COALESCE(a.country, 'unknown') AS k, count(*) AS t,
                                   count(*) FILTER (WHERE a.state IN ('failed', 'paid_not_granted')) AS fl
                            FROM a GROUP BY 1) s), '{}'::jsonb),
    'top_failure_codes', COALESCE((SELECT jsonb_agg(jsonb_build_object('stage', s.stage, 'code', s.code, 'count', s.c)
                                                    ORDER BY s.c DESC, s.code) FROM (
                            SELECT COALESCE(f.stage, 'unknown') AS stage, f.error_code AS code, count(*) AS c
                            FROM f WHERE f.error_code IS NOT NULL GROUP BY 1, 2 ORDER BY 3 DESC, 2 LIMIT 5) s), '[]'::jsonb),
    'nudge_scheduled',  (SELECT n.scheduled FROM n),
    'nudge_skipped_no_permission', (SELECT n.skipped FROM n)
  ) INTO v;
  RETURN v;
END;
$$;
REVOKE ALL ON FUNCTION public.attempt_insights_aggregate(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_aggregate(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- Tenants with a summary to write for the week [p_since, p_until): a budget above zero, at least one live attempt
-- in the window, and no row for the week yet. An idle tenant is never visited, so it never spends.
CREATE OR REPLACE FUNCTION public.attempt_insights_due(p_week_start DATE, p_since TIMESTAMPTZ, p_until TIMESTAMPTZ)
RETURNS TABLE (tenant_id UUID, budget_usd NUMERIC, model TEXT)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.id, t.ai_insights_budget_usd, t.ai_insights_model
  FROM tenants t
  WHERE t.ai_insights_budget_usd > 0
    AND EXISTS (SELECT 1 FROM checkout_attempts c
                 WHERE c.tenant_id = t.id AND c.mode = 'live' AND c.occurred_at >= p_since AND c.occurred_at < p_until)
    AND NOT EXISTS (SELECT 1 FROM attempt_insights i
                     WHERE i.tenant_id = t.id AND i.week_start = p_week_start AND i.status <> 'reserved')
  ORDER BY t.id;
END;
$$;
REVOKE ALL ON FUNCTION public.attempt_insights_due(DATE, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_due(DATE, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;

-- ── 6. Retention (D15) ────────────────────────────────────────────────────────────────────────────────
-- The tier's analytics_retention_days, like 211's alerts — but never inside the current calendar month: those
-- rows are what attempt_insights_month_spend_usd sums, and purging them would hand the budget back.
CREATE OR REPLACE FUNCTION public.tier_retention_purge_insights() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM attempt_insights i
  USING tenants t
  LEFT JOIN tier_definitions td ON td.tier_name = t.plan
  WHERE i.tenant_id = t.id
    AND i.created_at < LEAST(now() - make_interval(days => COALESCE(td.analytics_retention_days, 90)),
                             date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC');
END; $$;
REVOKE ALL ON FUNCTION public.tier_retention_purge_insights() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tier_retention_purge_insights() TO service_role;

-- ── 7. Scheduling — 211's jobs, now doing real work ───────────────────────────────────────────────────
-- 211 registered `paycraft_attempt_insights` (Monday 09:00 UTC) against this function as a no-op; it now POSTs
-- functions/v1/attempt-insights through paycraft_function_post (vault-configured; a laptop or CI database without
-- the vault entries calls nothing). The schedule itself is 211's and is not re-created here.
CREATE OR REPLACE FUNCTION public.attempt_insights_dispatch()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM paycraft_function_post('attempt-insights');
END; $$;
REVOKE ALL ON FUNCTION public.attempt_insights_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_dispatch() TO service_role;

-- 211's daily retention job, re-registered under the SAME name so it also purges insights.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('paycraft_attempt_retention', '41 4 * * *',
      $cron$ SELECT tier_retention_purge_attempts(); SELECT tier_retention_purge_alerts(); SELECT tier_retention_purge_insights(); $cron$);
  END IF;
END $$;
