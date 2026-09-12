-- 069 — Drop test_devices allow-list + is_test_only product flag
--
-- Replaces the per-device $0-Testing-Trial mechanism (migrations 067 + 068)
-- with Stripe-aligned test/live mode duality:
--   • Mode is encoded in the API key prefix (pk_test_*, pk_live_*)
--   • The SDK picks payment links from {test,live}_payment_links per provider
--   • The dashboard exposes a top-right Test/Live toggle (pc_mode cookie)
-- See: dashboard/lib/mode.ts + cmp-paycraft 2.0.10 (PayCraft.mode).
--
-- The Edge Function /config no longer reads device_id and no longer filters
-- by is_test_only — both are gone.
--
-- Idempotent. Safe to re-run after partial application or db reset.

-- ── 1. Drop RPCs that referenced is_test_only / test_devices ──────────────
-- Order matters: drop the upsert RPC first (depended on is_test_only column),
-- then the test_devices RPCs, then the table.

-- Revert tenant_products_upsert to its pre-068 signature (drop is_test_only).
-- This mirrors the migration 028 shape but written idempotently here.
CREATE OR REPLACE FUNCTION tenant_products_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_duration_days, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    p_row->>'sku',
    (p_row->>'type')::product_type,
    p_row->>'display_name',
    NULLIF(p_row->>'trial_duration_days','')::INT,
    NULLIF(p_row->>'attaches_to_product_id','')::UUID,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::INT, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::INT, 0),
    COALESCE((p_row->>'active')::BOOLEAN, true)
  )
  ON CONFLICT (id) DO UPDATE
    SET sku                    = EXCLUDED.sku,
        type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_duration_days    = EXCLUDED.trial_duration_days,
        attaches_to_product_id = EXCLUDED.attaches_to_product_id,
        interval               = EXCLUDED.interval,
        base_price_cents       = EXCLUDED.base_price_cents,
        base_currency          = EXCLUDED.base_currency,
        display_order          = EXCLUDED.display_order,
        active                 = EXCLUDED.active,
        updated_at             = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ── 2. Drop test_devices RPCs (signatures from migration 067) ─────────────
DROP FUNCTION IF EXISTS test_devices_is_registered(UUID, TEXT);
DROP FUNCTION IF EXISTS test_devices_list(UUID);
DROP FUNCTION IF EXISTS test_devices_register(UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS test_devices_revoke(UUID);

-- ── 3. Drop test_devices table (cascades RLS policies + index) ────────────
DROP TABLE IF EXISTS test_devices CASCADE;

-- ── 4. Drop is_test_only column on tenant_products ────────────────────────
ALTER TABLE tenant_products
  DROP COLUMN IF EXISTS is_test_only;
