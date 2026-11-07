-- 171 — tenant_products_upsert: restore what 158 dropped, keep what 158 added, and put the
--       function back into 089's core + thin-wrapper shape.
--
-- 158 rewrote the WRAPPER to accept grant_quantity, from an older body than 131. Three regressions
-- shipped with it, all silent:
--
--   1. Ten columns left the write path: trial_enabled, trial_per_platform, store_description,
--      pricing_mode, global_price_cents, global_currency, discount_percent, discount_ends_at,
--      play_product_id, app_store_product_id. An update never SETs them, so the API, MCP and the
--      dashboard all answer `updated: ["trial_enabled"]` while the row keeps its old value — a
--      trial cannot be turned on, a price mode cannot change, a store id cannot be corrected.
--      Measured on mbs/reels-downloader 2026-11-05: four trial_enabled writes, all "updated",
--      all still false on read-back.
--   2. The tenant-admin guard (083/084) was gone. The function is SECURITY DEFINER, so without it
--      any signed-in user could write products into any tenant.
--   3. The conflict key moved from (tenant_id, sku) back to (id), undoing 058/099's natural key:
--      an upsert by sku of an existing product failed on tenant_products_tenant_id_sku_key.
--
-- Root cause is the one 089 was written to end: 131 and 158 each pasted a full body into the
-- wrapper again (AC-8), so a column added in one copy was forgotten in the next. Here the single
-- column projection goes back into _tenant_products_upsert_core and the wrapper only guards and
-- delegates. A future column edits ONE body.

-- ── core: the one column projection (131's columns + 158's grant_quantity) ──────────────────────
CREATE OR REPLACE FUNCTION public._tenant_products_upsert_core(p_row jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_id    uuid;
  v_type  product_type;
  v_grant int;
BEGIN
  v_type  := (p_row->>'type')::product_type;
  v_grant := NULLIF(p_row->>'grant_quantity','')::int;

  -- Reject, never ignore (158): a dropped grant ships a product that sells and credits nothing.
  IF v_type = 'consumable' AND (v_grant IS NULL OR v_grant < 1) THEN
    RAISE EXCEPTION 'grant_quantity is required for a consumable product and must be >= 1'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_type <> 'consumable' AND v_grant IS NOT NULL THEN
    RAISE EXCEPTION 'grant_quantity is only valid for a consumable product (got type=%)', v_type
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO tenant_products AS tp (
    id, tenant_id, sku, type, display_name, store_description,
    trial_enabled, trial_duration_days, trial_per_platform, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active,
    pricing_mode, global_price_cents, global_currency,
    discount_percent, discount_ends_at,
    play_product_id, app_store_product_id,
    grant_quantity
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::uuid, gen_random_uuid()),
    (p_row->>'tenant_id')::uuid,
    p_row->>'sku',
    v_type,
    p_row->>'display_name',
    NULLIF(p_row->>'store_description', ''),
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
    NULLIF(p_row->>'app_store_product_id',''),
    v_grant
  )
  -- The natural key, per 058. `id` is intentionally absent from the SET list below.
  ON CONFLICT (tenant_id, sku) DO UPDATE
    SET type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        store_description      = EXCLUDED.store_description,
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
        grant_quantity         = EXCLUDED.grant_quantity,
        updated_at             = now()
  RETURNING tp.id INTO v_id;
  RETURN v_id;
END $fn$;

-- The core carries no ownership guard, so it must stay unreachable except through the wrapper
-- (089's security note). CREATE OR REPLACE keeps existing grants, but restate the revoke so this
-- file is correct on its own.
REVOKE EXECUTE ON FUNCTION public._tenant_products_upsert_core(jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._tenant_products_upsert_core(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._tenant_products_upsert_core(jsonb) FROM authenticated;

-- ── wrapper: auth guard + delegate (089's shape; AC-8 refuses an INSERT here) ───────────────────
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
