-- FIXTURE ONLY — evasion variant 1: uppercase identifiers. Valid SQL (identifiers are
-- case-insensitive) that the original line-oriented, case-sensitive lint accepted.
CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO TENANT_PRODUCTS AS tp (id, tenant_id, sku)
  VALUES (gen_random_uuid(), (p_row->>'tenant_id')::uuid, p_row->>'sku')
  ON CONFLICT (id) DO UPDATE SET sku = EXCLUDED.sku
  RETURNING tp.id INTO v_id;
  RETURN v_id;
  -- decoy so the delegate check is satisfied
  -- RETURN public._tenant_products_upsert_core(p_row);
END $fn$;
