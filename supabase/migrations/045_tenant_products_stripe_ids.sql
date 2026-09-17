-- Migration 045: tenant_products Stripe IDs + tenant_providers payment-links upsert RPC.
-- Pairs with Phase 2 of paycraft-dashboard-provider-integration epic.

-- 1. Add columns for tracking Stripe Product + per-currency Price IDs.
ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS stripe_product_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id_by_currency JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.tenant_products.stripe_product_id
  IS 'Stripe Product ID (prod_...) created via stripe-product-sync.ts on first save.';
COMMENT ON COLUMN public.tenant_products.stripe_price_id_by_currency
  IS 'Map of currency code (USD, INR, JPY) → Stripe Price ID (price_...).';

-- 2. RPC: set Stripe IDs on a product (membership-checked).
CREATE OR REPLACE FUNCTION tenant_products_set_stripe_ids(
  p_id UUID,
  p_stripe_product_id TEXT,
  p_stripe_price_id_by_currency JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'product not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE tenant_products SET
    stripe_product_id = p_stripe_product_id,
    stripe_price_id_by_currency = p_stripe_price_id_by_currency
  WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_products_set_stripe_ids(uuid, text, jsonb) TO authenticated;

-- 3. RPC: merge payment links into tenant_providers JSONB (idempotent — uses jsonb concat).
CREATE OR REPLACE FUNCTION tenant_providers_set_payment_links(
  p_tenant_id UUID,
  p_provider TEXT,
  p_mode TEXT,             -- 'test' | 'live'
  p_payment_links JSONB    -- { "USD": "https://buy.stripe.com/...", "INR": "..." }
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Ensure row exists (create empty if missing)
  INSERT INTO tenant_providers (tenant_id, provider, test_payment_links, live_payment_links)
  VALUES (p_tenant_id, p_provider, '{}'::jsonb, '{}'::jsonb)
  ON CONFLICT (tenant_id, provider) DO NOTHING;

  IF p_mode = 'live' THEN
    UPDATE tenant_providers
      SET live_payment_links = COALESCE(live_payment_links, '{}'::jsonb) || p_payment_links
      WHERE tenant_id = p_tenant_id AND provider = p_provider;
  ELSE
    UPDATE tenant_providers
      SET test_payment_links = COALESCE(test_payment_links, '{}'::jsonb) || p_payment_links
      WHERE tenant_id = p_tenant_id AND provider = p_provider;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_providers_set_payment_links(uuid, text, text, jsonb) TO authenticated;

-- 4. RPC: tenant_stripe_connect_status — lightweight connectivity check (no token decryption).
CREATE OR REPLACE FUNCTION tenant_stripe_connect_status(p_tenant_id UUID)
RETURNS TABLE (stripe_account_id TEXT, livemode BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT t.stripe_account_id, t.livemode
  FROM tenant_stripe_connect t
  WHERE t.tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_stripe_connect_status(uuid) TO authenticated;
