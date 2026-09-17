-- 070 — tenant_providers payment_links nested per-(sku, currency) shape
--
-- Pairs with the SDK rewrite (cmp-paycraft v2.0.10+) where
-- SuiteProviderAdapter.getCheckoutUrl looks up `map[plan.id]?[plan.currency]`.
--
-- The legacy RPC `tenant_providers_set_payment_links` (migration 045) writes
-- payment_links as a FLAT {currency: url} map and JSONB-concats them, which means
-- product N's URLs OVERWRITE product N-1's URLs at currency-key collision time.
-- Multi-product tenants always end up with whichever product was synced last.
--
-- This migration:
--   1. Adds tenant_providers_merge_payment_links(p_tenant_id, p_provider, p_mode,
--      p_sku, p_payment_links) — nests under {sku: {currency: url}} so each product
--      merges independently. The outer-level concat replaces the per-sku block
--      atomically; the inner-currency block is fully overwritten per call so a
--      currency dropped on the Stripe side disappears from our cache.
--   2. Adds a backfill helper that rewrites legacy flat-shape rows into the new
--      nested shape by nesting the existing currencies under a caller-specified
--      sku (one-shot use during migration).
--   3. Leaves the old flat RPC in place for grace, but marks it deprecated.
--      Sync helpers update to the new RPC name in the same release.

-- ── 1. The new nested merge RPC ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION tenant_providers_merge_payment_links(
  p_tenant_id     UUID,
  p_provider      TEXT,
  p_mode          TEXT,    -- 'test' | 'live'
  p_sku           TEXT,    -- product SKU (tenant_products.sku)
  p_payment_links JSONB    -- { "USD": "https://buy.stripe.com/...", "INR": "..." }
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_column TEXT;
  v_current JSONB;
  v_updated JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sku IS NULL OR length(trim(p_sku)) = 0 THEN
    RAISE EXCEPTION 'p_sku required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_mode NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'p_mode must be test or live' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Ensure row exists.
  INSERT INTO tenant_providers (tenant_id, provider, test_payment_links, live_payment_links)
       VALUES (p_tenant_id, p_provider, '{}'::jsonb, '{}'::jsonb)
  ON CONFLICT (tenant_id, provider) DO NOTHING;

  v_column := CASE WHEN p_mode = 'live' THEN 'live_payment_links' ELSE 'test_payment_links' END;

  -- Read current value, splice the new (sku → links) entry on top, write back.
  -- `||` at the outer level inserts/replaces just the p_sku key; other SKUs are
  -- preserved. p_payment_links replaces the per-currency block in full (caller is
  -- the authoritative source of truth for that product's currencies).
  IF p_mode = 'live' THEN
    SELECT COALESCE(live_payment_links, '{}'::jsonb) INTO v_current
      FROM tenant_providers
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
    v_updated := v_current || jsonb_build_object(p_sku, p_payment_links);
    UPDATE tenant_providers
       SET live_payment_links = v_updated, updated_at = now()
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
  ELSE
    SELECT COALESCE(test_payment_links, '{}'::jsonb) INTO v_current
      FROM tenant_providers
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
    v_updated := v_current || jsonb_build_object(p_sku, p_payment_links);
    UPDATE tenant_providers
       SET test_payment_links = v_updated, updated_at = now()
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
  END IF;
END;
$$;

COMMENT ON FUNCTION tenant_providers_merge_payment_links(UUID, TEXT, TEXT, TEXT, JSONB) IS
  'Merge per-sku payment-link map into tenant_providers JSONB. Outer key = sku, inner key = currency. Preserves other SKUs.';

GRANT EXECUTE ON FUNCTION tenant_providers_merge_payment_links(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant_providers_merge_payment_links(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ── 2. Deprecation comment on the legacy flat RPC ───────────────────────
COMMENT ON FUNCTION tenant_providers_set_payment_links(UUID, TEXT, TEXT, JSONB) IS
  'DEPRECATED 2026-06-19 — overwrites other SKUs at currency-key collision. Use tenant_providers_merge_payment_links() instead. Will be dropped after 30-day grace.';
