-- 221: an experiment variant can choose which plan the paywall PRE-SELECTS.
--
-- A variant stays an offering (088/206); it may now also carry `default_sku` — the plan its paywall opens on, in
-- place of the paywall's own default (`popular_plan_sku` / the workflow's `is_selected_by_default`). Stored inside
-- the existing `variants` jsonb: `[{key, weight, offering_id, default_sku?}]`. The SDK applies it; a missing or
-- unknown sku leaves the paywall's default.
--
-- Error added: experiment_default_sku_unknown — the sku is not an active product the variant's offering sells
-- (same join as 209: an active package of that offering holding an active product of this tenant).
-- Everything else is 206's functions unchanged. CREATE OR REPLACE = idempotent.

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
    -- (221) Absent, null or "" = the paywall's own default. Anything else must be a string naming a plan this
    -- variant's offering sells.
    IF v ? 'default_sku' AND jsonb_typeof(v->'default_sku') <> 'null' AND coalesce(v->>'default_sku', '') <> '' THEN
      IF jsonb_typeof(v->'default_sku') <> 'string' OR NOT EXISTS (
        SELECT 1 FROM tenant_packages pkg
          JOIN tenant_products pr ON pr.package_id = pkg.id AND pr.active AND pr.tenant_id = p_tenant_id
         WHERE pkg.offering_id::text = v->>'offering_id' AND pkg.active AND pr.sku = v->>'default_sku'
      ) THEN
        RAISE EXCEPTION 'experiment_default_sku_unknown';
      END IF;
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

-- The running experiment as `/config` serves it. `default_sku` only on variants that set one, so a payload without
-- any is byte-identical to 206's.
CREATE OR REPLACE FUNCTION public.paywall_experiment_public_get(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
           'key', e.key,
           'variants', (SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                 'key', v->>'key', 'weight', (v->>'weight')::int, 'offering_id', v->>'offering_id',
                                 'default_sku', nullif(v->>'default_sku', ''))))
                          FROM jsonb_array_elements(e.variants) v))
  FROM paywall_experiments e
  WHERE e.tenant_id = p_tenant_id AND e.status = 'running'
$$;

REVOKE ALL ON FUNCTION public.paywall_experiment_save(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_save(UUID, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.paywall_experiment_public_get(UUID) TO anon, authenticated, service_role;
