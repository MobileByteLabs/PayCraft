-- 073 — Per-product native store product IDs (Google Play + Apple App Store)
--
-- Phase 1 of PayCraft dashboard store-sync. Lets a tenant set the native
-- billing product identifiers on each product so the SDK's native lanes
-- (Google Play Billing on Android / StoreKit2 on iOS) can resolve them:
--   • play_product_id           → Google Play managed product / base-plan id
--   • app_store_product_id      → App Store Connect product id
--
-- The SDK already reads these (ProductDto.playProductId / appStoreProductId in
-- cmp-paycraft config/SuiteConfig.kt); the /config Edge Function already spreads
-- every tenant_products column (`...p`) and tenant_products_list is SELECT *.
-- So the only missing links were (a) the columns and (b) upsert wiring — added
-- here.
--
-- IMPORTANT — regression repair baked in: the currently-applied upsert (068 →
-- 069) was rebuilt on the migration-028 shape and silently DROPPED the columns
-- migration 047/050/051 added to tenant_products handling in the RPC:
--   trial_enabled, pricing_mode, global_price_cents, global_currency,
--   discount_percent, discount_ends_at
-- The columns still exist on the table and the dashboard form still sends them,
-- but 069's upsert ignored them, so they never persisted. This migration copies
-- 069's column set forward, RESTORES those six columns, and adds the two new
-- store-id columns — so nothing regresses. is_test_only is intentionally NOT
-- restored (069 dropped that column entirely).
--
-- Structure kept consistent with the existing (069) def: SECURITY DEFINER,
-- search_path = public, ON CONFLICT (id) DO UPDATE.
--
-- Idempotent. Safe to re-run after partial application or db reset.

-- ── 1. Columns ────────────────────────────────────────────────────────────
ALTER TABLE tenant_products
  ADD COLUMN IF NOT EXISTS play_product_id      TEXT,
  ADD COLUMN IF NOT EXISTS app_store_product_id TEXT;

-- ── 2. Upsert RPC — full column set + the two new store ids ────────────────
CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_enabled, trial_duration_days, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active,
    pricing_mode, global_price_cents, global_currency,
    discount_percent, discount_ends_at,
    play_product_id, app_store_product_id
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    p_row->>'sku',
    (p_row->>'type')::product_type,
    p_row->>'display_name',
    COALESCE((p_row->>'trial_enabled')::BOOLEAN, true),
    NULLIF(p_row->>'trial_duration_days','')::INT,
    NULLIF(p_row->>'attaches_to_product_id','')::UUID,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::INT, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::INT, 0),
    COALESCE((p_row->>'active')::BOOLEAN, true),
    COALESCE((p_row->>'pricing_mode')::pricing_mode, 'auto'::pricing_mode),
    NULLIF(p_row->>'global_price_cents','')::INT,
    NULLIF(p_row->>'global_currency',''),
    NULLIF(p_row->>'discount_percent','')::INT,
    NULLIF(p_row->>'discount_ends_at','')::TIMESTAMPTZ,
    NULLIF(p_row->>'play_product_id',''),
    NULLIF(p_row->>'app_store_product_id','')
  )
  ON CONFLICT (id) DO UPDATE
    SET sku                    = EXCLUDED.sku,
        type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_enabled          = EXCLUDED.trial_enabled,
        trial_duration_days    = EXCLUDED.trial_duration_days,
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
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_products_upsert(JSONB) TO authenticated;
