-- 209 — an experiment can only start when every variant's offering sells something.
--
-- A product belongs to ONE package (tenant_products.package_id), so a second offering built from the same
-- roles as the default one holds no products at all. Started, the SDK would hand that variant's devices an
-- empty paywall. Checked at START rather than save: a draft may be built before its products exist.
--
-- Error added: experiment_offering_empty. Everything else is 206's function unchanged.
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
  IF p_status = 'running' AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(row.variants) v
     WHERE NOT EXISTS (
       SELECT 1 FROM tenant_packages pkg JOIN tenant_products pr ON pr.package_id = pkg.id AND pr.active
        WHERE pkg.offering_id::text = v->>'offering_id' AND pkg.active)
  ) THEN
    RAISE EXCEPTION 'experiment_offering_empty';
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
