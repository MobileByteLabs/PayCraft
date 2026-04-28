-- Migration 008: Fix register_device — deduplicate active rows on same-device re-register
--
-- Problem: LIMIT 1 without ORDER BY is non-deterministic when multiple active rows
-- exist for the same email. Same-device check can pick the wrong row and trigger a
-- spurious conflict. Duplicate active rows accumulate on each app reinstall.
--
-- Fix:
--   1. ORDER BY registered_at DESC — always pick the most recent active row.
--   2. When same device re-registers, deactivate ALL other active rows for this
--      email+mode first, then return the surviving token. Prevents duplicates.

CREATE OR REPLACE FUNCTION register_device(
    p_email       TEXT,
    p_platform    TEXT,
    p_device_name TEXT,
    p_mode        TEXT DEFAULT 'live'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_token        TEXT;
    v_active_row   registered_devices%ROWTYPE;
    v_has_sub      BOOLEAN;
    v_conflict     BOOLEAN := false;
BEGIN
    -- Check active subscription exists
    SELECT EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = lower(trim(p_email))
          AND status IN ('active','trialing')
          AND mode = p_mode
          AND current_period_end > now()
    ) INTO v_has_sub;

    -- Pick the MOST RECENT active device for this email (deterministic)
    SELECT * INTO v_active_row
    FROM registered_devices
    WHERE lower(email) = lower(trim(p_email))
      AND mode = p_mode
      AND is_active = true
    ORDER BY registered_at DESC
    LIMIT 1;

    -- Same device re-registering (same platform + device_name)
    IF FOUND AND v_active_row.platform = p_platform
              AND v_active_row.device_name = p_device_name THEN

        -- Deactivate any duplicate active rows for this email+mode (keeps only this one)
        UPDATE registered_devices
        SET is_active  = false,
            revoked_at = now(),
            revoked_by = 'dedup'
        WHERE lower(email) = lower(trim(p_email))
          AND mode         = p_mode
          AND is_active    = true
          AND device_token != v_active_row.device_token;

        -- Return existing token — idempotent re-register
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
        -- Issue token as pending (is_active = false) — activated after verification
        v_conflict := true;
        INSERT INTO registered_devices
            (email, device_token, platform, device_name, mode, is_active)
        VALUES
            (lower(trim(p_email)), v_token, p_platform, p_device_name, p_mode, false);

        RETURN jsonb_build_object(
            'device_token',            v_token,
            'conflict',                true,
            'conflicting_device_name', v_active_row.device_name,
            'conflicting_last_seen',   v_active_row.last_seen_at
        );
    ELSE
        -- No active subscription OR no other active device → register and activate immediately
        INSERT INTO registered_devices
            (email, device_token, platform, device_name, mode, is_active)
        VALUES
            (lower(trim(p_email)), v_token, p_platform, p_device_name, p_mode, true);

        RETURN jsonb_build_object(
            'device_token',            v_token,
            'conflict',                false,
            'conflicting_device_name', null,
            'conflicting_last_seen',   null
        );
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION register_device(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
