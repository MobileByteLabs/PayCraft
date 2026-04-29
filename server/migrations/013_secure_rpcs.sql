-- Migration 013: Secure RPCs — Server Token Architecture
-- Fixes S2 (is_premium email enum), S3 (get_subscription data leak),
--        S4 (transfer_to_device account takeover), S5 (check_premium no ownership)
--
-- BEFORE: RPCs accept raw email → anyone with anon key can enumerate users
-- AFTER:  RPCs require server_token (from register_device) → token = proof of device ownership
--
-- register_device(email, platform, device_name, mode) stays email-based (entry point).
-- Everything else requires server_token.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. is_premium(server_token) — replaces is_premium(email)
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old email-based version
DROP FUNCTION IF EXISTS is_premium(text);

CREATE OR REPLACE FUNCTION is_premium(p_server_token TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT;
    v_mode  TEXT;
BEGIN
    -- Validate server_token exists and is active
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true;

    IF v_email IS NULL THEN
        RETURN false;  -- Invalid/revoked token = not premium
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = lower(v_email)
          AND status IN ('active', 'trialing')
          AND mode = v_mode
          AND current_period_end > now()
    );
END;
$$;

GRANT EXECUTE ON FUNCTION is_premium(text) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. get_subscription(server_token) — replaces get_subscription(email)
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old email-based version
DROP FUNCTION IF EXISTS get_subscription(text);

CREATE OR REPLACE FUNCTION get_subscription(p_server_token TEXT)
RETURNS SETOF subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_email TEXT;
    v_mode  TEXT;
BEGIN
    -- Validate server_token
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true;

    IF v_email IS NULL THEN
        RETURN;  -- Empty result — invalid token
    END IF;

    RETURN QUERY
        SELECT * FROM subscriptions
        WHERE email = lower(v_email)
          AND status IN ('active', 'past_due')
          AND mode = v_mode
        ORDER BY current_period_end DESC
        LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_subscription(text) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. check_premium_with_device(server_token) — drops email parameter
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old 3-arg version (email, device_token, mode)
DROP FUNCTION IF EXISTS check_premium_with_device(text, text, text);

CREATE OR REPLACE FUNCTION check_premium_with_device(p_server_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_email      TEXT;
    v_mode       TEXT;
    v_is_premium BOOLEAN;
BEGIN
    -- Validate token + update last_seen
    UPDATE registered_devices
    SET last_seen_at = now()
    WHERE device_token = p_server_token
      AND is_active = true
    RETURNING email, mode INTO v_email, v_mode;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('is_premium', false, 'token_valid', false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = lower(v_email)
          AND status IN ('active', 'trialing')
          AND mode = v_mode
          AND current_period_end > now()
    ) INTO v_is_premium;

    RETURN jsonb_build_object('is_premium', v_is_premium, 'token_valid', true);
END;
$$;

GRANT EXECUTE ON FUNCTION check_premium_with_device(text) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. transfer_to_device(server_token, new_device_token) — drops email param
--    Caller must own the server_token (current device) to transfer
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old 3-arg version (email, new_token, mode)
DROP FUNCTION IF EXISTS transfer_to_device(text, text, text);

CREATE OR REPLACE FUNCTION transfer_to_device(
    p_server_token    TEXT,
    p_new_device_token TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
    v_mode  TEXT;
    v_rows  INT;
BEGIN
    -- Validate caller's token exists (active OR pending — pending tokens are
    -- issued during register_device and are the caller's proof of identity
    -- during the conflict-resolution flow after OAuth/OTP verification).
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('transferred', false, 'reason', 'invalid_token');
    END IF;

    -- Verify new token belongs to same email and mode
    IF p_server_token != p_new_device_token THEN
        IF NOT EXISTS (
            SELECT 1 FROM registered_devices
            WHERE device_token = p_new_device_token
              AND lower(email) = lower(v_email)
              AND mode = v_mode
        ) THEN
            RETURN jsonb_build_object('transferred', false, 'reason', 'new_token_not_found');
        END IF;
    END IF;

    -- Revoke all currently active devices for this email
    UPDATE registered_devices
    SET is_active  = false,
        revoked_at = now(),
        revoked_by = 'transfer'
    WHERE lower(email) = lower(v_email)
      AND mode         = v_mode
      AND is_active    = true
      AND device_token != p_new_device_token;

    -- Activate the new token
    UPDATE registered_devices
    SET is_active = true
    WHERE device_token = p_new_device_token
      AND lower(email) = lower(v_email)
    RETURNING 1 INTO v_rows;

    IF v_rows IS NULL THEN
        RETURN jsonb_build_object('transferred', false, 'reason', 'activation_failed');
    END IF;

    RETURN jsonb_build_object('transferred', true);
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_to_device(text, text) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. revoke_device(server_token, target_device_token) — drops email param
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old 3-arg version (email, device_token, mode)
DROP FUNCTION IF EXISTS revoke_device(text, text, text);

CREATE OR REPLACE FUNCTION revoke_device(
    p_server_token     TEXT,
    p_target_token     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
    v_mode  TEXT;
BEGIN
    -- Validate caller owns this token
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('revoked', false, 'reason', 'invalid_token');
    END IF;

    -- Can only revoke devices belonging to the same email
    UPDATE registered_devices
    SET is_active  = false,
        revoked_at = now(),
        revoked_by = 'user'
    WHERE device_token = p_target_token
      AND lower(email) = lower(v_email)
      AND mode         = v_mode;

    RETURN jsonb_build_object('revoked', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_device(text, text) TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. get_active_devices(server_token) — drops email param
-- ═══════════════════════════════════════════════════════════════════════════

-- Drop old 2-arg version (email, mode)
DROP FUNCTION IF EXISTS get_active_devices(text, text);

CREATE OR REPLACE FUNCTION get_active_devices(p_server_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
    v_email TEXT;
    v_mode  TEXT;
BEGIN
    -- Validate caller owns this token
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true;

    IF v_email IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'device_token',  device_token,
            'platform',      platform,
            'device_name',   device_name,
            'registered_at', registered_at,
            'last_seen_at',  last_seen_at
        ))
        FROM registered_devices
        WHERE lower(email) = lower(v_email)
          AND mode         = v_mode
          AND is_active    = true
    ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_active_devices(text) TO anon, authenticated;
