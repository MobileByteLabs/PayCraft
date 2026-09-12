-- Migration 050: tenant_products.trial_enabled
--
-- Adds a per-product `trial_enabled` flag (default TRUE) so a subscription product
-- can advertise a default free-trial window without requiring a separate trial
-- product row + attaches_to_product_id linkage. Existing trial-type products
-- continue to work — their attaches_to_product_id linkage is unaffected.
--
-- The SDK reads BOTH:
--   1. `trial_enabled` + `trial_duration_days` directly on the subscription
--      product (preferred path, used by /idea-agent + new dashboard form)
--   2. Legacy trial-type ProductDto with attaches_to_product_id (kept for
--      backward compat with apps already on v2.0+ that authored trials this way)
--
-- See plan: paycraft-dashboard-provider-integration/06-sdk-finalize-and-real-app-validation.md (T4)

ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS trial_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.tenant_products.trial_enabled IS
  'Whether the product should advertise a free trial. Combined with trial_duration_days when type=subscription. Default TRUE — dashboard authors opt out explicitly.';

-- Ensure trial_duration_days has a sensible default for new rows (7 days) but
-- preserve NULL semantics for products that legitimately have no trial (e.g.
-- lifetime SKUs). The column already exists from earlier migrations.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_products'
      AND column_name = 'trial_duration_days'
  ) THEN
    ALTER TABLE public.tenant_products
      ALTER COLUMN trial_duration_days SET DEFAULT 7;
  ELSE
    ALTER TABLE public.tenant_products
      ADD COLUMN trial_duration_days INTEGER DEFAULT 7;
  END IF;
END $$;

-- Sanity guard: trial_duration_days, when set, must be in [1, 365]
ALTER TABLE public.tenant_products
  DROP CONSTRAINT IF EXISTS tenant_products_trial_duration_days_range;

ALTER TABLE public.tenant_products
  ADD CONSTRAINT tenant_products_trial_duration_days_range
  CHECK (
    trial_duration_days IS NULL
    OR (trial_duration_days >= 1 AND trial_duration_days <= 365)
  );
