-- 036_tier_enforcement.sql — Free-tier subscriber-cap with 7-day grace + warning thresholds
BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS grace_started_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS over_limit_warned_at TIMESTAMPTZ;

-- enforce_subscriber_cap — called from the existing register_device RPC.
-- Returns:
--   'ok'         → under cap, normal registration
--   'warn'       → ≥80% of cap, mark warned
--   'grace'      → at cap; first time → mark grace_started_at and allow
--   'refuse'     → grace expired (>7d) → REFUSE registration (caller raises exception)
CREATE OR REPLACE FUNCTION enforce_subscriber_cap(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count          INT;
  v_limit          INT;
  v_grace_started  TIMESTAMPTZ;
BEGIN
  SELECT active_count INTO v_count FROM tenant_subscriber_count_view
   WHERE tenant_id = p_tenant_id;
  v_count := COALESCE(v_count, 0);

  SELECT max_active_subscribers INTO v_limit
    FROM tier_definitions td JOIN tenants t ON t.plan = td.tier_name
   WHERE t.id = p_tenant_id;

  -- Unlimited tier → always ok
  IF v_limit IS NULL THEN
    RETURN 'ok';
  END IF;

  SELECT grace_started_at INTO v_grace_started FROM tenants WHERE id = p_tenant_id;

  IF v_count >= v_limit THEN
    IF v_grace_started IS NULL THEN
      UPDATE tenants SET grace_started_at = now() WHERE id = p_tenant_id;
      RETURN 'grace';
    ELSIF v_grace_started < now() - INTERVAL '7 days' THEN
      RETURN 'refuse';
    ELSE
      RETURN 'grace';
    END IF;
  ELSIF v_count >= (v_limit * 0.8)::INT THEN
    UPDATE tenants SET over_limit_warned_at = now()
     WHERE id = p_tenant_id AND over_limit_warned_at IS NULL;
    RETURN 'warn';
  ELSE
    -- Clear grace when usage drops back under limit
    IF v_grace_started IS NOT NULL THEN
      UPDATE tenants SET grace_started_at = NULL, over_limit_warned_at = NULL
       WHERE id = p_tenant_id;
    END IF;
    RETURN 'ok';
  END IF;
END;
$$;

-- Re-create upgrade_tenant_plan to clear grace + refresh entitlements.
-- (Replaces the version in 024_cloud_billing.sql.)
CREATE OR REPLACE FUNCTION upgrade_tenant_plan(p_tenant_id UUID, p_target_plan TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_target_plan NOT IN ('free','pro','enterprise') THEN
    RAISE EXCEPTION 'unknown_tier' USING HINT = 'p_target_plan must be free|pro|enterprise';
  END IF;

  UPDATE tenants
     SET plan                 = p_target_plan,
         grace_started_at     = NULL,
         over_limit_warned_at = NULL
   WHERE id = p_tenant_id;

  PERFORM refresh_tenant_entitlements(p_tenant_id);
END;
$$;

COMMIT;
