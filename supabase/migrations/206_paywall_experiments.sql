-- 206: paywall_experiments — A/B tests of what a paywall sells.
--
-- A variant is an OFFERING (088): the set of plans and prices a buyer sees. That is the lever that moves revenue —
-- which plans, at which prices, with which trial — so an experiment never needs its own copy of products.
--
-- Assignment is the SDK's: it hashes its per-app device ref with the experiment key into the variant weights, so a
-- device keeps its variant across launches with no server round trip and `/config` stays cacheable. The SDK then
-- tags every paywall event with `experiment` + `variant`, and the results read straight off `paywall_events`.
--
-- At most ONE running experiment per tenant (partial unique index): two concurrent tests over the same paywall
-- would confound each other's results.

CREATE TABLE IF NOT EXISTS public.paywall_experiments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  key         TEXT NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  name        TEXT NOT NULL DEFAULT '' CHECK (length(name) <= 100),
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'stopped')),
  -- [{ "key": "control", "weight": 50, "offering_id": "<uuid>" }, …] — validated by paywall_experiment_save.
  variants    JSONB NOT NULL DEFAULT '[]'::jsonb,
  started_at  TIMESTAMPTZ,
  stopped_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_paywall_experiment_key UNIQUE (tenant_id, key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_paywall_experiment_running
  ON public.paywall_experiments (tenant_id) WHERE status = 'running';

ALTER TABLE public.paywall_experiments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paywall_experiments_service_all ON public.paywall_experiments;
CREATE POLICY paywall_experiments_service_all ON public.paywall_experiments
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS paywall_experiments_admin_read ON public.paywall_experiments;
CREATE POLICY paywall_experiments_admin_read ON public.paywall_experiments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tenant_admins ta
             WHERE ta.tenant_id = paywall_experiments.tenant_id AND ta.user_id = auth.uid())
  );

-- Every event carries the experiment and variant the device was in when it happened (NULL = no experiment).
ALTER TABLE public.paywall_events
  ADD COLUMN IF NOT EXISTS experiment TEXT CHECK (experiment IS NULL OR experiment ~ '^[a-z0-9][a-z0-9-]{1,47}$'),
  ADD COLUMN IF NOT EXISTS variant    TEXT CHECK (variant IS NULL OR variant ~ '^[a-z0-9][a-z0-9-]{0,31}$');

CREATE INDEX IF NOT EXISTS paywall_events_tenant_experiment
  ON public.paywall_events (tenant_id, experiment, variant) WHERE experiment IS NOT NULL;

-- ── Save (create or edit) ─────────────────────────────────────────────────────────────────────
-- The one writer, so the rules live here and every caller (dashboard, API, SQL) gets the same answer.
-- Error codes (raised as the exception message): experiment_key_invalid, experiment_variants_count,
-- experiment_variant_key_invalid, experiment_variant_key_duplicate, experiment_weight_invalid,
-- experiment_offering_unknown, experiment_not_editable.
-- Only a draft is editable: changing variants under a running test would mix two experiments in one result.
CREATE OR REPLACE FUNCTION public.paywall_experiment_save(
  p_tenant_id UUID, p_key TEXT, p_name TEXT, p_variants JSONB
) RETURNS public.paywall_experiments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v JSONB;
  n INT;
  seen TEXT[] := '{}';
  row public.paywall_experiments;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-z0-9][a-z0-9-]{1,47}$' THEN RAISE EXCEPTION 'experiment_key_invalid'; END IF;
  IF jsonb_typeof(p_variants) <> 'array' THEN RAISE EXCEPTION 'experiment_variants_count'; END IF;
  n := jsonb_array_length(p_variants);
  IF n < 2 OR n > 4 THEN RAISE EXCEPTION 'experiment_variants_count'; END IF;
  FOR v IN SELECT * FROM jsonb_array_elements(p_variants) LOOP
    IF coalesce(v->>'key', '') !~ '^[a-z0-9][a-z0-9-]{0,31}$' THEN RAISE EXCEPTION 'experiment_variant_key_invalid'; END IF;
    IF (v->>'key') = ANY(seen) THEN RAISE EXCEPTION 'experiment_variant_key_duplicate'; END IF;
    seen := seen || (v->>'key');
    IF jsonb_typeof(v->'weight') <> 'number' OR (v->>'weight')::numeric <> floor((v->>'weight')::numeric)
       OR (v->>'weight')::int < 1 OR (v->>'weight')::int > 100 THEN
      RAISE EXCEPTION 'experiment_weight_invalid';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tenant_offerings o
                    WHERE o.tenant_id = p_tenant_id AND o.active AND o.id::text = v->>'offering_id') THEN
      RAISE EXCEPTION 'experiment_offering_unknown';
    END IF;
  END LOOP;

  SELECT * INTO row FROM paywall_experiments WHERE tenant_id = p_tenant_id AND key = p_key;
  IF FOUND AND row.status <> 'draft' THEN RAISE EXCEPTION 'experiment_not_editable'; END IF;

  INSERT INTO paywall_experiments (tenant_id, key, name, variants)
  VALUES (p_tenant_id, p_key, coalesce(p_name, ''), p_variants)
  ON CONFLICT (tenant_id, key) DO UPDATE
    SET name = EXCLUDED.name, variants = EXCLUDED.variants, updated_at = now()
  RETURNING * INTO row;
  RETURN row;
END
$$;

-- ── Start / stop ──────────────────────────────────────────────────────────────────────────────
-- draft → running → stopped, one way. A stopped test is never restarted: its results would mix two periods.
-- Errors: experiment_not_found, experiment_bad_transition, experiment_already_running (another one is).
CREATE OR REPLACE FUNCTION public.paywall_experiment_set_status(
  p_tenant_id UUID, p_key TEXT, p_status TEXT
) RETURNS public.paywall_experiments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE row public.paywall_experiments;
BEGIN
  SELECT * INTO row FROM paywall_experiments WHERE tenant_id = p_tenant_id AND key = p_key FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'experiment_not_found'; END IF;
  IF NOT ((row.status = 'draft' AND p_status = 'running') OR (row.status = 'running' AND p_status = 'stopped')) THEN
    RAISE EXCEPTION 'experiment_bad_transition';
  END IF;
  IF p_status = 'running' AND EXISTS (
    SELECT 1 FROM paywall_experiments WHERE tenant_id = p_tenant_id AND status = 'running'
  ) THEN
    RAISE EXCEPTION 'experiment_already_running';
  END IF;
  UPDATE paywall_experiments
     SET status = p_status,
         started_at = CASE WHEN p_status = 'running' THEN now() ELSE started_at END,
         stopped_at = CASE WHEN p_status = 'stopped' THEN now() ELSE stopped_at END,
         updated_at = now()
   WHERE id = row.id
  RETURNING * INTO row;
  RETURN row;
END
$$;

-- ── SDK read ──────────────────────────────────────────────────────────────────────────────────
-- The running experiment as `/config` serves it, or NULL. Offering ids only — the offerings themselves already
-- ride in the same payload.
CREATE OR REPLACE FUNCTION public.paywall_experiment_public_get(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'key', e.key,
           'variants', (SELECT jsonb_agg(jsonb_build_object(
                                 'key', v->>'key', 'weight', (v->>'weight')::int, 'offering_id', v->>'offering_id'))
                          FROM jsonb_array_elements(e.variants) v))
  FROM paywall_experiments e
  WHERE e.tenant_id = p_tenant_id AND e.status = 'running'
$$;

-- ── Results ───────────────────────────────────────────────────────────────────────────────────
-- Per variant: devices that saw the paywall, started checkout and bought (distinct device_ref — a device counts
-- once however often it reopened the paywall), and the conversion rate. Live mode only: a test purchase is not
-- revenue. Events dated outside the experiment's run are ignored.
CREATE OR REPLACE FUNCTION public.paywall_experiment_results(p_tenant_id UUID, p_key TEXT)
RETURNS TABLE (variant TEXT, viewers BIGINT, checkouts BIGINT, buyers BIGINT, conversion NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH exp AS (
    SELECT * FROM paywall_experiments WHERE tenant_id = p_tenant_id AND key = p_key
  ),
  arms AS (
    SELECT v->>'key' AS variant, ord FROM exp, jsonb_array_elements(exp.variants) WITH ORDINALITY AS t(v, ord)
  ),
  ev AS (
    SELECT pe.variant, pe.name, pe.device_ref
    FROM paywall_events pe, exp
    WHERE pe.tenant_id = p_tenant_id AND pe.experiment = p_key AND pe.mode = 'live'
      AND pe.device_ref IS NOT NULL
      AND pe.occurred_at >= coalesce(exp.started_at, exp.created_at)
      AND (exp.stopped_at IS NULL OR pe.occurred_at <= exp.stopped_at)
  ),
  agg AS (
    SELECT variant,
           count(DISTINCT device_ref) FILTER (WHERE name = 'paycraft_paywall_view')     AS viewers,
           count(DISTINCT device_ref) FILTER (WHERE name = 'paycraft_checkout_start')   AS checkouts,
           count(DISTINCT device_ref) FILTER (WHERE name = 'paycraft_purchase_success') AS buyers
    FROM ev GROUP BY variant
  )
  SELECT a.variant,
         coalesce(g.viewers, 0), coalesce(g.checkouts, 0), coalesce(g.buyers, 0),
         CASE WHEN coalesce(g.viewers, 0) = 0 THEN 0
              ELSE round(g.buyers::numeric / g.viewers, 4) END
  FROM arms a LEFT JOIN agg g ON g.variant = a.variant
  ORDER BY a.ord
$$;

REVOKE ALL ON FUNCTION public.paywall_experiment_save(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paywall_experiment_set_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paywall_experiment_results(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_save(UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_set_status(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_results(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_public_get(UUID) TO anon, authenticated, service_role;
