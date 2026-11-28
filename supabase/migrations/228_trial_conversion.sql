-- 228: trial → paid. entitlement_records keeps only the CURRENT state, so whether a subscription started as a free
-- trial — and whether that trial turned paid — was lost on the next store event. Two timestamps, stamped by a
-- trigger on every write path (the SDK grant's upsert and the webhooks' insert + guarded update alike):
--   trial_started_at    the first time the record was in `trial`
--   trial_converted_at  the first move from `trial` to a paid state (active / active_non_renewing / in_grace_period)
-- Experiment results (227) add trial_starts / trial_paid per arm.

ALTER TABLE public.entitlement_records
  ADD COLUMN IF NOT EXISTS trial_started_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_converted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.entitlement_trial_stamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.canonical_state = 'trial' AND NEW.trial_started_at IS NULL THEN
    NEW.trial_started_at := now();
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.canonical_state = 'trial' AND NEW.trial_converted_at IS NULL
     AND NEW.canonical_state IN ('active', 'active_non_renewing', 'in_grace_period') THEN
    NEW.trial_converted_at := now();
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS entitlement_trial_stamps ON public.entitlement_records;
CREATE TRIGGER entitlement_trial_stamps
  BEFORE INSERT OR UPDATE OF canonical_state ON public.entitlement_records
  FOR EACH ROW EXECUTE FUNCTION public.entitlement_trial_stamps();

-- Records in a trial today started it no later than they were created.
UPDATE public.entitlement_records SET trial_started_at = created_at
 WHERE canonical_state = 'trial' AND trial_started_at IS NULL;

DROP FUNCTION IF EXISTS public.paywall_experiment_results(UUID, TEXT);
CREATE FUNCTION public.paywall_experiment_results(p_tenant_id UUID, p_key TEXT)
RETURNS TABLE (variant TEXT, viewers BIGINT, checkouts BIGINT, buyers BIGINT, conversion NUMERIC,
               offer_views BIGINT, offer_accepts BIGINT, revenue JSONB, trial_starts BIGINT, trial_paid BIGINT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH exp AS (
    SELECT * FROM paywall_experiments WHERE tenant_id = p_tenant_id AND key = p_key
  ),
  arms AS (
    SELECT v->>'key' AS variant, ord FROM exp, jsonb_array_elements(exp.variants) WITH ORDINALITY AS t(v, ord)
  ),
  ev AS (
    SELECT pe.variant, pe.name, pe.device_ref, pe.sku, pe.currency
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
           count(DISTINCT device_ref) FILTER (WHERE name = 'paycraft_purchase_success') AS buyers,
           count(DISTINCT device_ref) FILTER (WHERE name = 'paycraft_offer_view')       AS offer_views,
           count(DISTINCT device_ref) FILTER (WHERE name = 'paycraft_offer_accept')     AS offer_accepts
    FROM ev GROUP BY variant
  ),
  -- one purchase per device and sku (a retried success event must not double the revenue)
  bought AS (
    SELECT DISTINCT variant, device_ref, sku, upper(currency) AS currency
    FROM ev WHERE name = 'paycraft_purchase_success' AND sku IS NOT NULL AND currency IS NOT NULL
  ),
  priced AS (
    SELECT b.variant, b.currency,
           (SELECT min(tp.amount_cents) FROM tenant_products pr
              JOIN tenant_pricing tp ON tp.product_id = pr.id AND upper(tp.currency) = b.currency
             WHERE pr.tenant_id = p_tenant_id AND pr.sku = b.sku) AS cents
    FROM bought b
  ),
  -- (228) buyers whose subscription started as a free trial, and those whose trial turned paid. A buyer is linked
  -- to their entitlement by the device (owner = device id) or the account (user_ref = hash of tenant + email).
  buyer_devices AS (
    SELECT DISTINCT pe.variant, pe.device_ref, pe.user_ref
    FROM paywall_events pe, exp
    WHERE pe.tenant_id = p_tenant_id AND pe.experiment = p_key AND pe.mode = 'live'
      AND pe.name = 'paycraft_purchase_success' AND pe.device_ref IS NOT NULL
      AND pe.occurred_at >= coalesce(exp.started_at, exp.created_at)
      AND (exp.stopped_at IS NULL OR pe.occurred_at <= exp.stopped_at)
  ),
  trials AS (
    SELECT b.variant, b.device_ref,
           bool_or(er.trial_converted_at IS NOT NULL) AS paid
    FROM buyer_devices b
    JOIN entitlement_records er ON er.tenant_id = p_tenant_id AND er.trial_started_at IS NOT NULL AND NOT er.is_sandbox
     AND (er.app_user_id = b.device_ref
          OR b.user_ref = encode(sha256(convert_to(p_tenant_id::text || ':' || lower(er.app_user_id), 'UTF8')), 'hex'))
    GROUP BY b.variant, b.device_ref
  ),
  trial_agg AS (
    SELECT variant, count(*) AS starts, count(*) FILTER (WHERE paid) AS converted FROM trials GROUP BY variant
  ),
  rev AS (
    SELECT variant, jsonb_object_agg(currency, total) AS revenue
    FROM (SELECT variant, currency, sum(cents)::bigint AS total FROM priced WHERE cents IS NOT NULL
           GROUP BY variant, currency) x
    GROUP BY variant
  )
  SELECT a.variant,
         coalesce(g.viewers, 0), coalesce(g.checkouts, 0), coalesce(g.buyers, 0),
         CASE WHEN coalesce(g.viewers, 0) = 0 THEN 0 ELSE round(g.buyers::numeric / g.viewers, 4) END,
         coalesce(g.offer_views, 0), coalesce(g.offer_accepts, 0),
         coalesce(r.revenue, '{}'::jsonb),
         coalesce(tr.starts, 0), coalesce(tr.converted, 0)
  FROM arms a LEFT JOIN agg g ON g.variant = a.variant LEFT JOIN rev r ON r.variant = a.variant
       LEFT JOIN trial_agg tr ON tr.variant = a.variant
  ORDER BY a.ord
$$;

REVOKE ALL ON FUNCTION public.paywall_experiment_results(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_results(UUID, TEXT) TO service_role;
