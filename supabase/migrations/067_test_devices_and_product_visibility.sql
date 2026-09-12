-- 067 — Testing devices registry + per-product test-only visibility
--
-- Adds the server-side enforcement layer for "internal QA only" products.
-- A tenant admin registers specific device fingerprints in `test_devices`;
-- products marked `is_test_only` are only included in the /config response
-- when the requesting device fingerprint matches a registered entry.
--
-- Why server-side: signed prod APKs cannot see test products at all (the
-- Edge Function never includes them in the response) — there is no client
-- flag that QA could accidentally flip in a release build.
--
-- Architecture:
--
--   1. tenant_products.is_test_only (BOOLEAN) — column on the product row
--   2. test_devices (table)                   — tenant's allow-list of device IDs
--   3. test_devices_is_registered (RPC)       — boolean check used by Edge Function
--   4. test_devices_list/register/revoke      — CRUD RPCs for the dashboard UI
--   5. RLS policies on test_devices           — only tenant admins read/write
--
-- The /config Edge Function calls test_devices_is_registered(tenant_id, device_id)
-- and filters out is_test_only products when the answer is false.

-- ── 1. is_test_only column on tenant_products ────────────────────────────
ALTER TABLE tenant_products
  ADD COLUMN IF NOT EXISTS is_test_only BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tenant_products.is_test_only IS
  'When true, this product only appears in /config responses to devices registered in test_devices for this tenant. Default false = visible to all consumers.';

-- ── 2. test_devices registry table ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS test_devices (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id    TEXT         NOT NULL,
  label        TEXT         NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT test_devices_tenant_device_unique UNIQUE (tenant_id, device_id)
);

COMMENT ON TABLE test_devices IS
  'Per-tenant allow-list of device fingerprints that may see is_test_only products. Managed via the dashboard Testing Devices page. Consumed by /config Edge Function.';

CREATE INDEX IF NOT EXISTS test_devices_tenant_idx ON test_devices(tenant_id);

-- ── 3. RLS — only tenant admins read/write their own rows ────────────────
ALTER TABLE test_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS test_devices_read   ON test_devices;
DROP POLICY IF EXISTS test_devices_write  ON test_devices;
DROP POLICY IF EXISTS test_devices_delete ON test_devices;

CREATE POLICY test_devices_read ON test_devices FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE POLICY test_devices_write ON test_devices FOR INSERT
  WITH CHECK (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE POLICY test_devices_delete ON test_devices FOR DELETE
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

-- ── 4. SECURITY DEFINER RPCs (callable by service_role + dashboard admins) ──

-- Used by the /config Edge Function on every request.
-- Returns true iff the device_id is registered for the tenant.
CREATE OR REPLACE FUNCTION test_devices_is_registered(
  p_tenant_id UUID,
  p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM test_devices
     WHERE tenant_id = p_tenant_id
       AND device_id = p_device_id
  );
$$;

COMMENT ON FUNCTION test_devices_is_registered(UUID, TEXT) IS
  'Edge-function hot path: returns true iff a device_id is in the tenant test_devices allow-list. Service-role-only (RLS bypassed via SECURITY DEFINER).';

-- Dashboard list view.
CREATE OR REPLACE FUNCTION test_devices_list(p_tenant_id UUID)
RETURNS SETOF test_devices
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  -- Caller MUST be an admin of the tenant (delegated to dashboard auth check
  -- below). RLS-bypass-as-SECURITY-DEFINER means we add the explicit guard.
  SELECT * FROM test_devices
   WHERE tenant_id = p_tenant_id
     AND tenant_id IN (
       SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()
     )
   ORDER BY created_at DESC;
$$;

-- Dashboard register.
CREATE OR REPLACE FUNCTION test_devices_register(
  p_tenant_id UUID,
  p_device_id TEXT,
  p_label     TEXT DEFAULT NULL
)
RETURNS test_devices
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row test_devices;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins ta WHERE ta.tenant_id = p_tenant_id AND ta.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
    RAISE EXCEPTION 'device_id required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO test_devices (tenant_id, device_id, label)
       VALUES (p_tenant_id, trim(p_device_id), nullif(trim(coalesce(p_label, '')), ''))
       ON CONFLICT (tenant_id, device_id) DO UPDATE SET label = EXCLUDED.label
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Dashboard revoke.
CREATE OR REPLACE FUNCTION test_devices_revoke(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM test_devices WHERE id = p_id;
  IF v_tenant IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins ta WHERE ta.tenant_id = v_tenant AND ta.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM test_devices WHERE id = p_id;
  RETURN true;
END;
$$;

-- ── 5. Grant execute on the RPCs ─────────────────────────────────────────
GRANT EXECUTE ON FUNCTION test_devices_is_registered(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION test_devices_list(UUID)                TO authenticated;
GRANT EXECUTE ON FUNCTION test_devices_register(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION test_devices_revoke(UUID)              TO authenticated;
