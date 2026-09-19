-- 131_product_store_description.sql
--
-- A home for the ONE line of copy both native stores show under a subscription's name.
--
-- WHAT WAS MISSING
-- Neither store had a source for it. Google Play was sent `listings: [{ languageCode, title }]` on
-- both create and re-sync, so a Play listing could never have a description at all. App Store
-- DERIVED one ("<name> — Billed yearly") and flagged it as machine-written, which is a reasonable
-- fallback but was the only option: there was nowhere for an operator to write real copy, so the
-- generated string was what customers saw on the store, permanently.
--
-- WHY ONE COLUMN AND NOT PER-STORE
-- The two stores want the same sentence, with different ceilings — Apple truncates at 45 characters,
-- Play at 80. Splitting it into two columns would ask operators to write the same line twice and
-- then drift; one column truncated per store keeps a single source of truth. Anyone who genuinely
-- needs divergent copy per store is describing a localization feature, which this is not.
--
-- NULL stays meaningful: no copy written yet → each store falls back to its derived string and says
-- so. This migration does NOT backfill, precisely so a derived description is never silently
-- promoted to "operator-authored".

ALTER TABLE tenant_products
  ADD COLUMN IF NOT EXISTS store_description text;

COMMENT ON COLUMN tenant_products.store_description IS
  'Operator-authored one-line store listing description, shown under the subscription name on the '
  'App Store and Google Play. Truncated per store (Apple 45 chars, Play 80). NULL → each store '
  'falls back to a derived string and reports that it was auto-generated.';

-- Length guard at the widest store ceiling. Anything longer is a paste accident, not copy: the
-- stores would truncate it mid-word without telling anyone.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_products_store_description_len'
  ) THEN
    ALTER TABLE tenant_products
      ADD CONSTRAINT tenant_products_store_description_len
      CHECK (store_description IS NULL OR char_length(store_description) <= 80);
  END IF;
END $$;

-- The upsert enumerates its columns, so a new column is invisible to it until it is named here.
-- Without this the form would appear to save and the value would be silently dropped — the exact
-- "it looks like it worked" failure this session has been removing everywhere else.
--
-- Empty string collapses to NULL: a cleared input must mean "no copy written" (and fall back to the
-- derived string), not "the description is the empty string", which would ship a blank line to the
-- stores and read as authored.
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
    id, tenant_id, sku, type, display_name, store_description,
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
    NULLIF(p_row->>'store_description', ''),
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
        updated_at             = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;

$function$;
