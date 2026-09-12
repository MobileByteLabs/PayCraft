-- Migration 047: tenant_products — pricing_mode enum + global_price columns.
-- Pairs with Phase 3 of paycraft-dashboard-provider-integration epic.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'pricing_mode') THEN
    CREATE TYPE pricing_mode AS ENUM ('auto', 'manual', 'global');
  END IF;
END $$;

ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS pricing_mode     pricing_mode NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS global_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS global_currency    TEXT;

COMMENT ON COLUMN public.tenant_products.pricing_mode IS
  'auto: country-wise prices from account template. manual: user sets each country individually. global: one price for all (uses global_price_cents + global_currency).';

COMMENT ON COLUMN public.tenant_products.global_price_cents IS
  'Used only when pricing_mode = global. Minor units (cents for USD, paise for INR, etc.).';
