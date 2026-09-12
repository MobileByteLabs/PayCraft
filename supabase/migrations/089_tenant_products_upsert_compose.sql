-- 089_tenant_products_upsert_compose.sql — R5: retire the copy-paste chain.
--
-- tenant_products_upsert has been redefined EIGHT times (028 → 051 → 058 → 068 → 069 → 073 →
-- 083 → 084 → 087), each a full copy of the prior 21-column body with one thing changed. Every
-- copy is a chance for a column to be added in one place and forgotten in another, and reviewing
-- a diff of two 60-line bodies to find the one changed line is exactly the review nobody does.
--
-- The split: _tenant_products_upsert_core owns the single canonical column projection; the
-- wrapper owns the auth guard and delegates. A future column addition edits ONE body.
--
-- SECURITY NOTE (not in the original plan, deliberately added):
-- The core is SECURITY DEFINER and carries NO ownership guard — that guard lives in the wrapper.
-- Left executable by `authenticated`, the core would therefore be a privilege-escalation path:
-- any logged-in user could write any tenant's products by calling it directly and bypassing the
-- wrapper entirely. EXECUTE is revoked from PUBLIC/anon/authenticated below. The wrapper is itself
-- SECURITY DEFINER, so it still reaches the core as the function owner.

CREATE OR REPLACE FUNCTION public._tenant_products_upsert_core(p_row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  INSERT INTO tenant_products AS tp (
    id, tenant_id, sku, type, display_name,
    trial_enabled, trial_duration_days, trial_per_platform, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active,
    pricing_mode, global_price_cents, global_currency,
    discount_percent, discount_ends_at,
    play_product_id, app_store_product_id
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::uuid, gen_random_uuid()),
    (p_row->>'tenant_id')::uuid,
    p_row->>'sku',
    (p_row->>'type')::product_type,
    p_row->>'display_name',
    COALESCE((p_row->>'trial_enabled')::boolean, true),
    NULLIF(p_row->>'trial_duration_days','')::int,
    NULLIF(p_row->>'trial_per_platform','')::jsonb,
    NULLIF(p_row->>'attaches_to_product_id','')::uuid,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::int, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::int, 0),
    COALESCE((p_row->>'active')::boolean, true),
    COALESCE((p_row->>'pricing_mode')::pricing_mode, 'auto'::pricing_mode),
    NULLIF(p_row->>'global_price_cents','')::int,
    NULLIF(p_row->>'global_currency',''),
    NULLIF(p_row->>'discount_percent','')::int,
    NULLIF(p_row->>'discount_ends_at','')::timestamptz,
    NULLIF(p_row->>'play_product_id',''),
    NULLIF(p_row->>'app_store_product_id','')
  )
  ON CONFLICT (id) DO UPDATE
    SET sku                    = EXCLUDED.sku,
        type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_enabled          = EXCLUDED.trial_enabled,
        trial_duration_days    = EXCLUDED.trial_duration_days,
        trial_per_platform     = EXCLUDED.trial_per_platform,
        attaches_to_product_id = EXCLUDED.attaches_to_product_id,
        interval               = EXCLUDED.interval,
        base_price_cents       = EXCLUDED.base_price_cents,
        base_currency          = EXCLUDED.base_currency,
        display_order          = EXCLUDED.display_order,
        active                 = EXCLUDED.active,
        pricing_mode           = EXCLUDED.pricing_mode,
        global_price_cents     = EXCLUDED.global_price_cents,
        global_currency        = EXCLUDED.global_currency,
        discount_percent       = EXCLUDED.discount_percent,
        discount_ends_at       = EXCLUDED.discount_ends_at,
        play_product_id        = EXCLUDED.play_product_id,
        app_store_product_id   = EXCLUDED.app_store_product_id,
        updated_at             = now()
  RETURNING tp.id INTO v_id;
  RETURN v_id;
END $fn$;

REVOKE EXECUTE ON FUNCTION public._tenant_products_upsert_core(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._tenant_products_upsert_core(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._tenant_products_upsert_core(jsonb) FROM authenticated;

-- Thin wrapper: auth guard + delegate. This is the ONLY tenant_products_upsert body allowed to
-- exist from 089 onward. The AC-8 shape lint refuses a later migration that reintroduces a full
-- INSERT copy here — that refusal is the point of the whole refactor.
CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM tenant_admins
     WHERE tenant_id = (p_row->>'tenant_id')::uuid AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN public._tenant_products_upsert_core(p_row);
END $fn$;

GRANT EXECUTE ON FUNCTION public.tenant_products_upsert(jsonb) TO authenticated, service_role;
