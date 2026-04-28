-- Migration 009: Add device_id for hardware-unique same-device detection
-- device_name stays as display label only; device_id is the identity key.
-- Backward compat: p_device_id DEFAULT NULL — old 4-arg clients continue working.

-- 1. Add device_id column (nullable for backward compat with existing rows)
ALTER TABLE public.registered_devices
  ADD COLUMN IF NOT EXISTS device_id TEXT;

-- 2. Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_registered_devices_device_id
  ON public.registered_devices (device_id)
  WHERE device_id IS NOT NULL;

-- 3. Update register_device: same-device check uses device_id when provided
CREATE OR REPLACE FUNCTION register_device(
    p_email       TEXT,
    p_platform    TEXT,
    p_device_name TEXT,
    p_device_id   TEXT DEFAULT NULL,   -- NULL = legacy client (falls back to name-based check)
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

    -- Pick the most recent active device for this email (deterministic)
    SELECT * INTO v_active_row
    FROM registered_devices
    WHERE lower(email) = lower(trim(p_email))
      AND mode = p_mode
      AND is_active = true
    ORDER BY registered_at DESC
    LIMIT 1;

    -- Same-device check:
    --   If p_device_id provided → match on device_id (hardware identity, secure)
    --   If p_device_id NULL     → legacy fallback: match on platform + device_name
    IF FOUND AND (
        (p_device_id IS NOT NULL AND v_active_row.device_id = p_device_id)
        OR
        (p_device_id IS NULL AND v_active_row.platform = p_platform
                              AND v_active_row.device_name = p_device_name)
    ) THEN
        -- Same device re-registering — dedup other active rows, return existing token
        UPDATE registered_devices
        SET is_active  = false,
            revoked_at = now(),
            revoked_by = 'dedup'
        WHERE lower(email) = lower(trim(p_email))
          AND mode         = p_mode
          AND is_active    = true
          AND device_token != v_active_row.device_token;

        -- Backfill device_id if it was missing (first new-client re-register)
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
