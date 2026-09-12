-- FIXTURE ONLY — evasion variant 2: the statement wraps across lines, so the substring
-- "INSERT INTO tenant_products" never appears on any single line.
CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO
      tenant_products AS tp (id, tenant_id, sku)
  VALUES (gen_random_uuid(), (p_row->>'tenant_id')::uuid, p_row->>'sku')
  ON CONFLICT (id) DO UPDATE SET sku = EXCLUDED.sku
  RETURNING tp.id INTO v_id;
  RETURN public._tenant_products_upsert_core(p_row);
END $fn$;
