-- 087_trial_per_platform.sql
-- Per-PLATFORM free-trial durations.
--
-- Until now a product carried ONE trial (`trial_enabled` bool + `trial_duration_days`
-- int) that fanned identically to every provider/platform. Operators want to pick a
-- trial length PER platform (android / ios / web / desktop) — e.g. 30d on Android,
-- 14d on iOS, 7d on the web PSP — each stored + synced to that platform's provider.
--
-- New JSONB column `trial_per_platform`, backward-compatible:
--   shape  {"android":30,"ios":14,"web":7,"desktop":14}
--   key PRESENT with an int  → trial of that many days on that platform
--   key ABSENT / null        → NO trial on that platform
--   {} or null               → no per-platform config; fall back to legacy
--                              trial_enabled + trial_duration_days
--
-- The legacy `trial_enabled` / `trial_duration_days` columns are KEPT (never dropped)
-- so existing callers + the SDK contract stay intact.
--
-- Additive + idempotent (safe under `supabase db reset` / partial re-apply):
--   * ADD COLUMN IF NOT EXISTS guards the column add
--   * the backfill only touches rows still NULL, so re-running is a no-op

-- ── column ────────────────────────────────────────────────────────────────────
ALTER TABLE tenant_products
  ADD COLUMN IF NOT EXISTS trial_per_platform jsonb;

COMMENT ON COLUMN tenant_products.trial_per_platform IS
  'Per-platform free-trial days, e.g. {"android":30,"ios":14,"web":7,"desktop":14}. '
  'Key present=trial of N days on that platform; key absent/null=no trial there; '
  '{}/null=no per-platform config, fall back to legacy trial_enabled+trial_duration_days.';

-- ── backfill ──────────────────────────────────────────────────────────────────
-- Existing trial-enabled rows get the SAME duration on all four platforms so their
-- behavior is unchanged. Only rows without a per-platform config yet are touched, so
-- re-applying this migration is a no-op (idempotent).
UPDATE tenant_products
   SET trial_per_platform = jsonb_build_object(
         'android', trial_duration_days,
         'ios',     trial_duration_days,
         'web',     trial_duration_days,
         'desktop', trial_duration_days
       )
 WHERE trial_enabled = true
   AND trial_duration_days IS NOT NULL
   AND trial_per_platform IS NULL;

-- ── RPC: re-create tenant_products_upsert threading trial_per_platform ─────────
-- Copied VERBATIM from 084_rpc_guard_allow_backend.sql (including the
-- `IF auth.uid() IS NOT NULL AND NOT EXISTS(tenant_admins…) forbidden` backend
-- guard), with the new trial_per_platform field threaded into INSERT + VALUES +
-- ON CONFLICT DO UPDATE. Legacy trial_enabled/trial_duration_days keep threading.
-- Grant unchanged (function is granted to `authenticated` elsewhere; CREATE OR
-- REPLACE preserves existing grants).
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
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
