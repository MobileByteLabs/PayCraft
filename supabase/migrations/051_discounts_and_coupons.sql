-- Migration 051 — promotional discounts + coupon codes.
--
-- Two complementary mechanisms live side by side:
--   1. Product-level discount  (tenant_products.discount_percent + .discount_ends_at)
--      Auto-applied to every checkout of this product. No code required from the
--      customer. Use for "30% off launch week", marketing pages, paywall banners.
--   2. Coupon code             (tenant_coupons)
--      Customer types a code at checkout. Code can apply to all products or a
--      subset (applies_to_product_ids). Duration controls how long the discount
--      persists across recurring invoices — Stripe-aligned semantics.
--
-- Both record `stripe_coupon_id` once a corresponding Stripe Coupon has been
-- synced for the connected account. The dashboard's stripe-product-sync code
-- reads this column to attach `discounts:[{coupon: ...}]` to checkout sessions.

-- ---------------------------------------------------------------------------
-- 1. Product-level discount columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS discount_percent  INTEGER,
  ADD COLUMN IF NOT EXISTS discount_ends_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS discount_stripe_coupon_id TEXT;

ALTER TABLE public.tenant_products
  DROP CONSTRAINT IF EXISTS tenant_products_discount_percent_range;

ALTER TABLE public.tenant_products
  ADD CONSTRAINT tenant_products_discount_percent_range
  CHECK (
    discount_percent IS NULL
    OR (discount_percent >= 1 AND discount_percent <= 99)
  );

COMMENT ON COLUMN public.tenant_products.discount_percent IS
  '1-99: percentage off base_price_cents. NULL = no discount. Same percentage uniformly across every currency in tenant_pricing.';
COMMENT ON COLUMN public.tenant_products.discount_ends_at IS
  'Optional ISO timestamp when the discount expires. NULL = no expiry (until you remove discount_percent).';
COMMENT ON COLUMN public.tenant_products.discount_stripe_coupon_id IS
  'Auto-populated by Stripe sync — the Stripe Coupon id created from discount_percent. Used at checkout to apply the discount.';

-- ---------------------------------------------------------------------------
-- 2. tenant_coupons — code-based discounts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_coupons (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code                     TEXT NOT NULL,           -- the user-visible promo code (e.g. "WELCOME25")
  name                     TEXT,                    -- optional display name ("Launch week")
  percent_off              INTEGER NOT NULL,        -- 1..100
  duration                 TEXT NOT NULL DEFAULT 'once',   -- 'once' | 'repeating' | 'forever'
  duration_in_months       INTEGER,                 -- required when duration = 'repeating'
  max_redemptions          INTEGER,                 -- NULL = unlimited
  redeem_by                TIMESTAMPTZ,             -- NULL = no expiry
  applies_to_product_ids   UUID[] NOT NULL DEFAULT ARRAY[]::UUID[], -- empty = applies to ALL products
  stripe_coupon_id         TEXT,                    -- set by sync
  stripe_promotion_code_id TEXT,                    -- set by sync (the customer-typeable code object)
  times_redeemed           INTEGER NOT NULL DEFAULT 0,
  active                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tenant_coupons_percent_off_range
    CHECK (percent_off >= 1 AND percent_off <= 100),
  CONSTRAINT tenant_coupons_duration_enum
    CHECK (duration IN ('once', 'repeating', 'forever')),
  CONSTRAINT tenant_coupons_repeating_needs_months
    CHECK (duration <> 'repeating' OR (duration_in_months IS NOT NULL AND duration_in_months >= 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS tenant_coupons_tenant_code_key
  ON public.tenant_coupons (tenant_id, code);

CREATE INDEX IF NOT EXISTS tenant_coupons_tenant_active_idx
  ON public.tenant_coupons (tenant_id, active);

COMMENT ON TABLE public.tenant_coupons IS
  'Per-tenant promo codes. Maps 1:1 to Stripe Coupon + PromotionCode. duration controls recurring application: once = first invoice only; repeating = duration_in_months invoices; forever = every invoice.';

-- ---------------------------------------------------------------------------
-- 3. RLS — tenant_admins can read/write their own; service_role full access.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenant_coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_coupons_admin_select" ON public.tenant_coupons;
CREATE POLICY "tenant_coupons_admin_select"
  ON public.tenant_coupons FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_admins WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tenant_coupons_admin_write" ON public.tenant_coupons;
CREATE POLICY "tenant_coupons_admin_write"
  ON public.tenant_coupons FOR ALL
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.tenant_admins WHERE user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 4. RPCs
-- ---------------------------------------------------------------------------

-- tenant_coupons_upsert — insert or update a coupon for the calling user's tenant.
CREATE OR REPLACE FUNCTION public.tenant_coupons_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := (p_row->>'tenant_id')::UUID;
  v_id        UUID := (p_row->>'id')::UUID;
BEGIN
  -- Authorisation — the calling user must be an admin of the target tenant.
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = v_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden — not an admin of tenant %', v_tenant_id;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO tenant_coupons (
      tenant_id, code, name, percent_off, duration, duration_in_months,
      max_redemptions, redeem_by, applies_to_product_ids, active
    ) VALUES (
      v_tenant_id,
      p_row->>'code',
      p_row->>'name',
      (p_row->>'percent_off')::INTEGER,
      COALESCE(p_row->>'duration', 'once'),
      NULLIF((p_row->>'duration_in_months')::INTEGER, 0),
      NULLIF((p_row->>'max_redemptions')::INTEGER, 0),
      NULLIF((p_row->>'redeem_by')::TIMESTAMPTZ, NULL),
      COALESCE(
        ARRAY(SELECT (jsonb_array_elements_text(p_row->'applies_to_product_ids'))::UUID),
        ARRAY[]::UUID[]
      ),
      COALESCE((p_row->>'active')::BOOLEAN, TRUE)
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE tenant_coupons SET
      code                   = COALESCE(p_row->>'code', code),
      name                   = COALESCE(p_row->>'name', name),
      percent_off            = COALESCE((p_row->>'percent_off')::INTEGER, percent_off),
      duration               = COALESCE(p_row->>'duration', duration),
      duration_in_months     = COALESCE((p_row->>'duration_in_months')::INTEGER, duration_in_months),
      max_redemptions        = COALESCE((p_row->>'max_redemptions')::INTEGER, max_redemptions),
      redeem_by              = COALESCE((p_row->>'redeem_by')::TIMESTAMPTZ, redeem_by),
      applies_to_product_ids = COALESCE(
        ARRAY(SELECT (jsonb_array_elements_text(p_row->'applies_to_product_ids'))::UUID),
        applies_to_product_ids
      ),
      active                 = COALESCE((p_row->>'active')::BOOLEAN, active),
      updated_at             = NOW()
    WHERE id = v_id AND tenant_id = v_tenant_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_coupons_upsert(JSONB) TO authenticated;

-- tenant_coupons_list — list active coupons for a tenant (used by dashboard + applies_to multi-select).
CREATE OR REPLACE FUNCTION public.tenant_coupons_list(p_tenant_id UUID)
RETURNS SETOF public.tenant_coupons
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
    SELECT * FROM tenant_coupons
    WHERE tenant_id = p_tenant_id
    ORDER BY created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_coupons_list(UUID) TO authenticated;

-- tenant_coupons_delete — soft-delete (mark inactive) — keeps redemption history intact.
CREATE OR REPLACE FUNCTION public.tenant_coupons_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_coupons WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'coupon not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  UPDATE tenant_coupons SET active = FALSE, updated_at = NOW() WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_coupons_delete(UUID) TO authenticated;

-- tenant_coupon_validate — public API used by the SDK at checkout to verify a code.
-- Returns the row if redeemable (active, not past redeem_by, not over max_redemptions,
-- applies to the given product). Caller passes the tenant API key via resolve_tenant
-- upstream, so by the time we land here we already know the tenant_id is authentic.
CREATE OR REPLACE FUNCTION public.tenant_coupon_validate(
  p_tenant_id UUID,
  p_code      TEXT,
  p_product_id UUID
)
RETURNS TABLE (
  id          UUID,
  code        TEXT,
  name        TEXT,
  percent_off INTEGER,
  duration    TEXT,
  duration_in_months INTEGER,
  redeem_by   TIMESTAMPTZ,
  stripe_coupon_id TEXT,
  stripe_promotion_code_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT c.id, c.code, c.name, c.percent_off, c.duration, c.duration_in_months,
           c.redeem_by, c.stripe_coupon_id, c.stripe_promotion_code_id
    FROM tenant_coupons c
    WHERE c.tenant_id = p_tenant_id
      AND c.code = p_code
      AND c.active = TRUE
      AND (c.redeem_by IS NULL OR c.redeem_by > NOW())
      AND (c.max_redemptions IS NULL OR c.times_redeemed < c.max_redemptions)
      AND (
        cardinality(c.applies_to_product_ids) = 0  -- empty = applies to all
        OR p_product_id = ANY (c.applies_to_product_ids)
      );
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_coupon_validate(UUID, TEXT, UUID) TO anon, authenticated;

-- tenant_coupons_set_stripe_ids — internal writer used by the Stripe sync code after
-- a Stripe Coupon + PromotionCode have been created in the connected account.
CREATE OR REPLACE FUNCTION public.tenant_coupons_set_stripe_ids(
  p_id                       UUID,
  p_stripe_coupon_id         TEXT,
  p_stripe_promotion_code_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tenant_coupons
  SET stripe_coupon_id         = p_stripe_coupon_id,
      stripe_promotion_code_id = p_stripe_promotion_code_id,
      updated_at               = NOW()
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_coupons_set_stripe_ids(UUID, TEXT, TEXT) TO authenticated;

-- tenant_products_set_discount_coupon_id — writer used by Stripe sync after the
-- product-level discount Coupon has been created.
CREATE OR REPLACE FUNCTION public.tenant_products_set_discount_coupon_id(
  p_id                        UUID,
  p_discount_stripe_coupon_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tenant_products
  SET discount_stripe_coupon_id = p_discount_stripe_coupon_id
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_products_set_discount_coupon_id(UUID, TEXT) TO authenticated;

-- tenant_coupons_increment_redeemed — fired by the Stripe webhook after a successful
-- redemption so the dashboard can show usage caps in real time.
CREATE OR REPLACE FUNCTION public.tenant_coupons_increment_redeemed(
  p_stripe_coupon_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE tenant_coupons
  SET times_redeemed = times_redeemed + 1,
      updated_at     = NOW()
  WHERE stripe_coupon_id = p_stripe_coupon_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_coupons_increment_redeemed(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Re-define tenant_products_upsert so it carries every column added by
--    migrations 045–051 (the original from 028 enumerated only the v1.0 set).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
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
    discount_percent, discount_ends_at
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
    COALESCE((p_row->>'pricing_mode')::pricing_mode, 'auto'),
    NULLIF(p_row->>'global_price_cents','')::INT,
    NULLIF(p_row->>'global_currency',''),
    NULLIF(p_row->>'discount_percent','')::INT,
    NULLIF(p_row->>'discount_ends_at','')::TIMESTAMPTZ
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
        updated_at             = NOW()
    RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM tenant_products
    WHERE id = COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid());
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_products_upsert(JSONB) TO authenticated;
