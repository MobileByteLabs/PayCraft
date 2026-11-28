-- 227: experiment variants can also vary the EXIT OFFER and the PAYWALL DESIGN; results add revenue and offer
-- uptake; a winning variant can be made the default in one step.
--
-- New optional variant fields (inside `variants` jsonb, next to 221's default_sku):
--   exit_offer            boolean   false = no exit offer for this arm (absent/true = the tenant's, migration 226)
--   exit_offer_coupon_id  uuid      this arm's exit-offer coupon instead of the tenant's (a percent-off coupon of
--                                   this tenant)
--   paywall_template      text      branded-stack | minimal | premium | dark — this arm's design (the SDK renders the
--                                   template's seed instead of the published tree)
-- Errors added: experiment_exit_offer_invalid, experiment_exit_coupon_unknown, experiment_template_unknown.
-- CREATE OR REPLACE / DROP IF EXISTS = idempotent.

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
    IF v ? 'default_sku' AND jsonb_typeof(v->'default_sku') <> 'null' AND coalesce(v->>'default_sku', '') <> '' THEN
      IF jsonb_typeof(v->'default_sku') <> 'string' OR NOT EXISTS (
        SELECT 1 FROM tenant_packages pkg
          JOIN tenant_products pr ON pr.package_id = pkg.id AND pr.active AND pr.tenant_id = p_tenant_id
         WHERE pkg.offering_id::text = v->>'offering_id' AND pkg.active AND pr.sku = v->>'default_sku'
      ) THEN
        RAISE EXCEPTION 'experiment_default_sku_unknown';
      END IF;
    END IF;
    -- (227) exit offer on/off, its coupon, the design.
    IF v ? 'exit_offer' AND jsonb_typeof(v->'exit_offer') NOT IN ('boolean', 'null') THEN
      RAISE EXCEPTION 'experiment_exit_offer_invalid';
    END IF;
    IF coalesce(v->>'exit_offer_coupon_id', '') <> '' AND NOT EXISTS (
      SELECT 1 FROM tenant_coupons c
       WHERE c.tenant_id = p_tenant_id AND c.id::text = v->>'exit_offer_coupon_id' AND coalesce(c.percent_off, 0) > 0
    ) THEN
      RAISE EXCEPTION 'experiment_exit_coupon_unknown';
    END IF;
    IF coalesce(v->>'paywall_template', '') <> ''
       AND v->>'paywall_template' NOT IN ('branded-stack', 'minimal', 'premium', 'dark') THEN
      RAISE EXCEPTION 'experiment_template_unknown';
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

-- The running experiment as `/config` serves it. Per variant, only what it sets: `exit_offer` is false (off) or the
-- override coupon's discount (only while that coupon is active); `paywall_template` when set. A payload with none of
-- these is byte-identical to 221's.
CREATE OR REPLACE FUNCTION public.paywall_experiment_public_get(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'key', e.key,
           'variants', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                 'key', v->>'key', 'weight', (v->>'weight')::int, 'offering_id', v->>'offering_id',
                                 'default_sku', nullif(v->>'default_sku', ''),
                                 'paywall_template', nullif(v->>'paywall_template', ''),
                                 'exit_offer', CASE
                                   WHEN v->'exit_offer' = 'false'::jsonb THEN 'false'::jsonb
                                   ELSE (SELECT jsonb_strip_nulls(jsonb_build_object(
                                                  'percent_off', c.percent_off, 'duration', coalesce(c.duration, 'once'),
                                                  'duration_in_months', c.duration_in_months))
                                           FROM tenant_coupons c
                                          WHERE c.tenant_id = e.tenant_id AND c.active
                                            AND c.id::text = nullif(v->>'exit_offer_coupon_id', '')
                                            AND (c.redeem_by IS NULL OR c.redeem_by > now()))
                                 END)) ORDER BY ord)
                          FROM jsonb_array_elements(e.variants) WITH ORDINALITY AS t(v, ord)))
  FROM paywall_experiments e
  WHERE e.tenant_id = p_tenant_id AND e.status = 'running'
$$;

-- Results per variant (live mode, inside the run window, distinct devices). Adds the exit-offer uptake and revenue:
-- each buyer's purchases priced at the catalogue price of the bought SKU in the event's currency, summed per
-- currency → `revenue` {"INR": 79900}. A purchase whose price is unknown counts as a buyer but adds no revenue.
DROP FUNCTION IF EXISTS public.paywall_experiment_results(UUID, TEXT);
CREATE FUNCTION public.paywall_experiment_results(p_tenant_id UUID, p_key TEXT)
RETURNS TABLE (variant TEXT, viewers BIGINT, checkouts BIGINT, buyers BIGINT, conversion NUMERIC,
               offer_views BIGINT, offer_accepts BIGINT, revenue JSONB)
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
         coalesce(r.revenue, '{}'::jsonb)
  FROM arms a LEFT JOIN agg g ON g.variant = a.variant LEFT JOIN rev r ON r.variant = a.variant
  ORDER BY a.ord
$$;

-- Make a variant the default: its offering becomes current, its pre-selected plan the paywall's popular plan, its
-- exit-offer choice the tenant's, its design the paywall's template (the published tree is unpublished so the
-- template shows — the draft tree is kept and can be republished); a running experiment is stopped.
-- experiment_not_found / experiment_variant_unknown otherwise.
CREATE OR REPLACE FUNCTION public.paywall_experiment_promote(p_tenant_id UUID, p_key TEXT, p_variant TEXT)
RETURNS public.paywall_experiments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.paywall_experiments;
  v JSONB;
BEGIN
  SELECT * INTO e FROM paywall_experiments WHERE tenant_id = p_tenant_id AND key = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'experiment_not_found'; END IF;
  SELECT x INTO v FROM jsonb_array_elements(e.variants) x WHERE x->>'key' = p_variant;
  IF v IS NULL THEN RAISE EXCEPTION 'experiment_variant_unknown'; END IF;

  UPDATE tenant_offerings SET is_current = (id::text = v->>'offering_id'), updated_at = now()
   WHERE tenant_id = p_tenant_id AND (is_current OR id::text = v->>'offering_id');
  IF coalesce(v->>'default_sku', '') <> '' THEN
    UPDATE tenant_paywall SET popular_plan_sku = v->>'default_sku' WHERE tenant_id = p_tenant_id;
  END IF;
  IF coalesce(v->>'paywall_template', '') <> '' THEN
    UPDATE tenant_paywall SET template = (v->>'paywall_template')::paywall_template, published_workflow = NULL WHERE tenant_id = p_tenant_id;
  END IF;
  IF v->'exit_offer' = 'false'::jsonb THEN
    UPDATE tenant_exit_survey SET exit_offer_enabled = false, updated_at = now() WHERE tenant_id = p_tenant_id;
  ELSIF coalesce(v->>'exit_offer_coupon_id', '') <> '' THEN
    UPDATE tenant_exit_survey SET exit_offer_enabled = true, exit_offer_coupon_id = (v->>'exit_offer_coupon_id')::uuid,
                                  updated_at = now()
     WHERE tenant_id = p_tenant_id;
  END IF;
  IF e.status = 'running' THEN
    UPDATE paywall_experiments SET status = 'stopped', stopped_at = now(), updated_at = now()
     WHERE id = e.id RETURNING * INTO e;
  END IF;
  RETURN e;
END
$$;

REVOKE ALL ON FUNCTION public.paywall_experiment_save(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paywall_experiment_results(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.paywall_experiment_promote(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_save(UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_results(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_promote(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_public_get(UUID) TO anon, authenticated, service_role;
