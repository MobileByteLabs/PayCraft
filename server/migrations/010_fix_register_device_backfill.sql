-- Migration 010: Fix register_device backfill path + revoked_by constraint
--
-- Bug 1 (migration 005→008): migration 008 introduced revoked_by='dedup' in the RPC
-- but forgot to update the CHECK constraint from migration 005. Constraint only allowed
-- ['transfer','user','admin']. Any dedup operation would throw a constraint violation.
-- Fix: add 'dedup' to the revoked_by constraint.
--
-- Bug 2 (migration 009): the backfill code (lines 68-71) was unreachable because
-- the same-device check required `v_active_row.device_id = p_device_id` when
-- p_device_id is provided. If the existing row has device_id=null, this check
-- evaluates to NULL (unknown) which is falsy — so legacy users upgrading to a
-- device_id-aware app version would always get a conflict.
--
-- Fix: add a backfill path that matches by name when the existing row has
-- device_id=null, regardless of whether the client provides a device_id or not.
-- This allows legacy rows to be identified by name and have device_id backfilled
-- transparently on first re-register from the new client version.

-- Fix 1: Add 'dedup' to revoked_by constraint (missed in migration 008)
ALTER TABLE registered_devices DROP CONSTRAINT IF EXISTS registered_devices_revoked_by_check;
ALTER TABLE registered_devices ADD CONSTRAINT registered_devices_revoked_by_check
    CHECK (revoked_by IN ('transfer', 'user', 'admin', 'dedup'));

-- Fix 2: Rewrite register_device with reachable backfill path
CREATE OR REPLACE FUNCTION register_device(
    p_email       TEXT,
    p_platform    TEXT,
    p_device_name TEXT,
    p_device_id   TEXT DEFAULT NULL,   -- NULL = legacy client (no device_id support)
    p_mode        TEXT DEFAULT 'live'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_token        TEXT;
    v_active_row   registered_devices%ROWTYPE;
    v_has_sub      BOOLEAN;
BEGIN
    -- Check active subscription exists
    SELECT EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = lower(trim(p_email))
          AND status IN ('active','trialing')
          AND mode = p_mode
          AND current_period_end > now()
    ) INTO v_has_sub;

    -- Pick the most recent active device for this email+mode (deterministic)
    SELECT * INTO v_active_row
    FROM registered_devices
    WHERE lower(email) = lower(trim(p_email))
      AND mode = p_mode
      AND is_active = true
    ORDER BY registered_at DESC
    LIMIT 1;

    -- Same-device check (3-tier):
    --   Tier 1: device_id match (hardware identity, both sides non-null — preferred)
    --   Tier 2: backfill path — existing row has null device_id → name match
    --           (handles users upgrading to device_id-aware app; backfills device_id below)
    --   Tier 3: legacy client — p_device_id=null → name match (no backfill)
    --
    -- Tiers 2+3 collapse to the same condition: if existing row has no device_id, use name match.
    IF FOUND AND (
        (p_device_id IS NOT NULL AND v_active_row.device_id IS NOT NULL AND v_active_row.device_id = p_device_id)
        OR
        (v_active_row.device_id IS NULL AND v_active_row.platform = p_platform AND v_active_row.device_name = p_device_name)
        OR
        (p_device_id IS NULL AND v_active_row.platform = p_platform AND v_active_row.device_name = p_device_name)
    ) THEN
        -- Same device re-registering — dedup other stale active rows
        UPDATE registered_devices
        SET is_active  = false,
            revoked_at = now(),
            revoked_by = 'dedup'
        WHERE lower(email) = lower(trim(p_email))
          AND mode         = p_mode
          AND is_active    = true
          AND device_token != v_active_row.device_token;

        -- Backfill device_id if client just upgraded to device_id-aware version
        IF p_device_id IS NOT NULL AND v_active_row.device_id IS NULL THEN
            UPDATE registered_devices
            SET device_id = p_device_id
            WHERE device_token = v_active_row.device_token;
        END IF;

        RETURN jsonb_build_object(
            'device_token',            v_active_row.device_token,
            'conflict',                false,
            'conflicting_device_name', null,
            'conflicting_last_seen',   null
        );
    END IF;

    -- Generate new server token
    v_token := 'srv_' || replace(gen_random_uuid()::text, '-', '');

    IF v_has_sub AND FOUND THEN
        -- Active subscription + different active device → conflict
        INSERT INTO registered_devices
            (email, device_token, platform, device_name, device_id, mode, is_active)
        VALUES
            (lower(trim(p_email)), v_token, p_platform, p_device_name, p_device_id, p_mode, false);

        RETURN jsonb_build_object(
            'device_token',            v_token,
            'conflict',                true,
            'conflicting_device_name', v_active_row.device_name,
            'conflicting_last_seen',   v_active_row.last_seen_at
        );
    ELSE
        -- No active subscription OR no other active device → register immediately
        INSERT INTO registered_devices
            (email, device_token, platform, device_name, device_id, mode, is_active)
        VALUES
            (lower(trim(p_email)), v_token, p_platform, p_device_name, p_device_id, p_mode, true);

        RETURN jsonb_build_object(
            'device_token',            v_token,
            'conflict',                false,
            'conflicting_device_name', null,
            'conflicting_last_seen',   null
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION register_device(TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
-- Keep old 4-arg signature for backward compat (legacy clients without device_id)
GRANT EXECUTE ON FUNCTION register_device(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
