-- FIXTURE ONLY — never applied. A hypothetical ninth copy: someone adds a column by pasting the
-- whole body again instead of editing _tenant_products_upsert_core. This is the exact regression
-- the 089 refactor exists to prevent, so the shape lint must refuse it.
CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_admins
     WHERE tenant_id = (p_row->>'tenant_id')::uuid AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO tenant_products AS tp (id, tenant_id, sku, type, display_name, some_new_column)
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::uuid, gen_random_uuid()),
    (p_row->>'tenant_id')::uuid, p_row->>'sku',
    (p_row->>'type')::product_type, p_row->>'display_name',
    NULLIF(p_row->>'some_new_column','')
  )
  ON CONFLICT (id) DO UPDATE SET sku = EXCLUDED.sku
  RETURNING tp.id INTO v_id;
  RETURN v_id;
END $fn$;
