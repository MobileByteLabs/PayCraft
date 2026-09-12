-- 099_restore_upsert_natural_key.sql
--
-- Restores `ON CONFLICT (tenant_id, sku)` to tenant_products_upsert.
--
-- THIS IS A REGRESSION, NOT A LONGSTANDING BUG — which matters, because the fix already exists in
-- this repo's history and was undone by accident.
--
--   028  created tenant_products with a PRIMARY KEY on (id) AND a UNIQUE (tenant_id, sku).
--   051  redefined the upsert declaring only `ON CONFLICT (id)`.
--   058  FIXED exactly this: "hit duplicate key value violates unique constraint
--        tenant_products_tenant_id_sku_key when the dashboard sent a fresh UUID for a SKU that
--        already existed … Resolution: use (tenant_id, sku) as the conflict target instead —
--        that's the natural key from the API's perspective."
--   084  re-declared the function to add the tenant_admins guard.
--   087  re-declared it again to thread trial_per_platform, and its own header says it was
--        "Copied VERBATIM from 084_rpc_guard_allow_backend.sql" — carrying 084's `ON CONFLICT (id)`
--        back in and silently reverting 058.
--
-- The failure mode is precisely the one 058 described: the dashboard PATCHes a product with a fresh
-- UUID for an existing SKU, `ON CONFLICT (id)` finds no id collision, the INSERT proceeds, and the
-- (tenant_id, sku) unique constraint raises. The caller sees a 500 on what should be an idempotent
-- update. It is also why the epic's canary seed could not be re-run without a manual DELETE.
--
-- WHY id STILL HAS TO BE HANDLED
-- Switching the conflict target alone would break the OTHER call shape: an update that DOES send a
-- known id and changes the sku. With `ON CONFLICT (tenant_id, sku)` that lands as an INSERT with an
-- existing primary key and raises on the pkey instead — trading one error for another.
-- 058's resolution and this one therefore keep `COALESCE(NULLIF(p_row->>'id',''), gen_random_uuid())`
-- for the id column but conflict on the natural key, and deliberately DO NOT write `id` in the
-- UPDATE arm: on a sku match the existing row keeps its own primary key, so any references to it
-- stay valid. Sending a new UUID for an existing SKU is now an idempotent update, which is what the
-- dashboard has always assumed.
--
-- Everything else is 087's body verbatim, including the tenant_admins guard with its
-- `auth.uid() IS NOT NULL AND` prefix (084's fix — the prefix lets service_role through; removing it
-- locks out the backend, which is the defect 083 shipped and 084 repaired).

CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = (p_row->>'tenant_id')::uuid AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_enabled, trial_duration_days, trial_per_platform, attaches_to_product_id, interval,
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
    NULLIF(p_row->>'trial_per_platform','')::jsonb,
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
  -- The natural key, per 058. `id` is intentionally absent from the SET list below.
  ON CONFLICT (tenant_id, sku) DO UPDATE
    SET type                   = EXCLUDED.type,
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
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

-- Grants are preserved by CREATE OR REPLACE, but restated so this migration is self-describing:
-- 091 revoked anon and granted authenticated + service_role.
REVOKE EXECUTE ON FUNCTION public.tenant_products_upsert(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_products_upsert(jsonb) TO authenticated, service_role;
