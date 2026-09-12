-- 068 — tenant_products_upsert: thread is_test_only through INSERT and UPDATE
--
-- Migration 067 added the is_test_only column to tenant_products; the existing
-- tenant_products_upsert RPC (migration 028) doesn't know about it, so the
-- dashboard's product editor couldn't actually flip the toggle. This redefines
-- the RPC to pick up is_test_only from the JSONB row (default false on INSERT)
-- and propagate it on UPDATE.

CREATE OR REPLACE FUNCTION tenant_products_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_duration_days, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active,
    is_test_only
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    p_row->>'sku',
    (p_row->>'type')::product_type,
    p_row->>'display_name',
    NULLIF(p_row->>'trial_duration_days','')::INT,
    NULLIF(p_row->>'attaches_to_product_id','')::UUID,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::INT, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::INT, 0),
    COALESCE((p_row->>'active')::BOOLEAN, true),
    COALESCE((p_row->>'is_test_only')::BOOLEAN, false)
  )
  ON CONFLICT (id) DO UPDATE
    SET sku                    = EXCLUDED.sku,
        type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_duration_days    = EXCLUDED.trial_duration_days,
        attaches_to_product_id = EXCLUDED.attaches_to_product_id,
        interval               = EXCLUDED.interval,
        base_price_cents       = EXCLUDED.base_price_cents,
        base_currency          = EXCLUDED.base_currency,
        display_order          = EXCLUDED.display_order,
        active                 = EXCLUDED.active,
        is_test_only           = EXCLUDED.is_test_only,
        updated_at             = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
