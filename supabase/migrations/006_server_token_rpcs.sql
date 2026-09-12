-- Migration 006: Server-token RPCs for device binding

-- ─── register_device ─────────────────────────────────────────────────────────
-- Called on app launch. Issues a pending token for this device.
-- If email has no active subscription:  token issued, is_active = true (no conflict possible)
-- If email has active subscription + active device = this re-registers:  return existing token
-- If email has active subscription + different active device:  token issued as pending (is_active=false), conflict=true
--
-- Returns: { device_token, conflict, conflicting_device_name, conflicting_last_seen }
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

    -- Check existing active device for this email
    SELECT * INTO v_active_row
    FROM registered_devices
    WHERE lower(email) = lower(trim(p_email))
      AND mode = p_mode
      AND is_active = true
    LIMIT 1;

    -- Same device re-registering (same platform + device_name)
    IF FOUND AND v_active_row.platform = p_platform
              AND v_active_row.device_name = p_device_name THEN
        -- Return existing token — idempotent
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

-- ─── check_premium_with_device ───────────────────────────────────────────────
-- Replaces is_premium(). Single round trip: validates token + checks subscription.
-- Side effect: updates last_seen_at (free — no extra query).
CREATE OR REPLACE FUNCTION check_premium_with_device(
    p_email        TEXT,
    p_device_token TEXT,
    p_mode         TEXT DEFAULT 'live'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_token_valid BOOLEAN;
    v_is_premium  BOOLEAN;
BEGIN
    -- Update last_seen_at + check token validity in one statement
    UPDATE registered_devices
    SET last_seen_at = now()
    WHERE device_token = p_device_token
      AND is_active    = true
    RETURNING true INTO v_token_valid;

    v_token_valid := COALESCE(v_token_valid, false);

    IF NOT v_token_valid THEN
        RETURN jsonb_build_object('is_premium', false, 'token_valid', false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = lower(trim(p_email))
          AND status IN ('active','trialing')
          AND mode = p_mode
          AND current_period_end > now()
    ) INTO v_is_premium;

    RETURN jsonb_build_object('is_premium', v_is_premium, 'token_valid', true);
END;
$$;

GRANT EXECUTE ON FUNCTION check_premium_with_device(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── transfer_to_device ──────────────────────────────────────────────────────
-- Called AFTER ownership is verified (OAuth or OTP).
-- Revokes all other active devices for this email, activates the pending token.
CREATE OR REPLACE FUNCTION transfer_to_device(
    p_email       TEXT,
    p_new_token   TEXT,
    p_mode        TEXT DEFAULT 'live'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_rows INT;
BEGIN
    -- Revoke all currently active devices for this email
    UPDATE registered_devices
    SET is_active  = false,
        revoked_at = now(),
        revoked_by = 'transfer'
    WHERE lower(email) = lower(trim(p_email))
      AND mode         = p_mode
      AND is_active    = true
      AND device_token != p_new_token;

    -- Activate the new (pending) token
    UPDATE registered_devices
    SET is_active = true
    WHERE device_token = p_new_token
      AND lower(email) = lower(trim(p_email))
    RETURNING 1 INTO v_rows;

    IF v_rows IS NULL THEN
        RETURN jsonb_build_object('transferred', false, 'reason', 'token_not_found');
    END IF;

    RETURN jsonb_build_object('transferred', true);
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_to_device(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── revoke_device ───────────────────────────────────────────────────────────
-- User-initiated: "Remove this device" from device list.
CREATE OR REPLACE FUNCTION revoke_device(
    p_email        TEXT,
    p_device_token TEXT,
    p_mode         TEXT DEFAULT 'live'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE registered_devices
    SET is_active  = false,
        revoked_at = now(),
        revoked_by = 'user'
    WHERE device_token = p_device_token
      AND lower(email) = lower(trim(p_email))
      AND mode         = p_mode;

    RETURN jsonb_build_object('revoked', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_device(TEXT, TEXT, TEXT) TO anon, authenticated;

-- ─── get_active_devices ──────────────────────────────────────────────────────
-- Returns all active registered devices for an email.
CREATE OR REPLACE FUNCTION get_active_devices(
    p_email TEXT,
    p_mode  TEXT DEFAULT 'live'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    RETURN (
        SELECT jsonb_agg(jsonb_build_object(
            'device_token',  device_token,
            'platform',      platform,
            'device_name',   device_name,
            'registered_at', registered_at,
            'last_seen_at',  last_seen_at
        ))
        FROM registered_devices
        WHERE lower(email) = lower(trim(p_email))
          AND mode         = p_mode
          AND is_active    = true
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_active_devices(TEXT, TEXT) TO anon, authenticated;
