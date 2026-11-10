-- 178_device_limit.sql — one subscription, up to N active devices (per tenant).
--
-- WHY. Until now an account had exactly ONE active device: register_device reported a conflict the
-- moment any other device was active, and transfer_to_device revoked EVERY other device. An app that
-- sells one subscription for the phone app AND the website (the Netflix / Prime model) needs a buyer
-- to be signed in on, say, their Android phone and their laptop browser at the same time — and, when
-- they reach the limit, to choose WHICH device to sign out rather than losing all of them.
--
-- WHAT.
--   · tenants.max_active_devices (default 1 → every existing tenant keeps today's behaviour exactly).
--   · register_device: conflict only when the account already has max_active_devices active devices;
--     the conflict answer lists those devices by `device_ref` (registered_devices.id) — never their
--     tokens — so the new device can offer "remove one to continue". The legacy
--     conflicting_device_name / conflicting_last_seen fields stay for older SDKs.
--   · transfer_to_device(…, p_replace_device): signs out exactly the chosen device of the SAME account,
--     then activates the new one. Without a choice it signs out the least-recently-seen devices until
--     the new one fits — for a limit of 1 that is "all others", i.e. the old behaviour.
--   · Manage devices: get_active_devices lists the account's devices by device_ref (+ this_device, never
--     tokens) and is opened to the publishable key; sign_out_device(token, device_ref) signs one out.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, DROP FUNCTION IF EXISTS for the old
-- transfer_to_device signature. The anon allowlist of migration 107 is kept: the new signature gets
-- the same grants the old one had.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_active_devices INT NOT NULL DEFAULT 1;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_max_active_devices_check') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_max_active_devices_check
      CHECK (max_active_devices BETWEEN 1 AND 10);
  END IF;
END $$;
COMMENT ON COLUMN tenants.max_active_devices IS
  'How many devices one subscriber may have active at once (any mix of android/ios/web/desktop). '
  'Reaching it makes a new sign-in a conflict that the buyer resolves by removing a device (178).';

-- ── register_device ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION register_device(
    p_email       TEXT,
    p_platform    TEXT,
    p_device_name TEXT,
    p_device_id   TEXT,
    p_mode        TEXT DEFAULT 'live',
    p_api_key     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id  UUID;
    v_token      TEXT;
    v_same       TEXT;
    v_latest_name TEXT;
    v_latest_seen TIMESTAMPTZ;
    v_active     INT;
    v_max        INT;
    v_conflict   BOOLEAN := false;
    v_subject    UUID;
    v_list       JSONB;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);
    v_subject   := entitlement_subject_resolve('email', NULL, p_email, false);
    SELECT COALESCE(max_active_devices, 1) INTO v_max FROM tenants WHERE id = v_tenant_id;
    v_max := COALESCE(v_max, 1);

    -- The same device signing in again (same name + platform, still active) keeps its seat and token.
    SELECT device_token INTO v_same
    FROM registered_devices
    WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
      AND mode = p_mode
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
      AND device_name IS NOT DISTINCT FROM p_device_name
      AND platform = p_platform
    ORDER BY registered_at DESC
    LIMIT 1;
    IF v_same IS NOT NULL THEN
        RETURN jsonb_build_object(
            'server_token', v_same,
            'conflict', false,
            'conflicting_device_name', null,
            'conflicting_last_seen', null,
            'max_devices', v_max,
            'active_devices', '[]'::jsonb
        );
    END IF;

    SELECT count(*) INTO v_active
    FROM registered_devices
    WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
      AND mode = p_mode
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    v_conflict := v_active >= v_max;

    IF v_conflict THEN
        SELECT device_name, last_seen_at INTO v_latest_name, v_latest_seen
        FROM registered_devices
        WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
          AND mode = p_mode AND is_active = true
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
        ORDER BY registered_at DESC
        LIMIT 1;
        -- Named by device_ref (the row id), never by token: a token is a capability, and this answer
        -- goes to a device that is not entitled yet.
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'device_ref',    id::text,
                   'device_name',   device_name,
                   'platform',      platform,
                   'registered_at', registered_at,
                   'last_seen_at',  last_seen_at
               ) ORDER BY COALESCE(last_seen_at, registered_at) DESC), '[]'::jsonb)
        INTO v_list
        FROM registered_devices
        WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
          AND mode = p_mode AND is_active = true
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    END IF;

    v_token := 'srv_' || replace(gen_random_uuid()::text, '-', '');

    -- `is_active = NOT v_conflict` IS LOAD-BEARING (see 155): the column defaults to FALSE and every
    -- read RPC filters on it. A conflicting device gets a token so it can drive the transfer, but is
    -- not entitled until the buyer removes a device.
    INSERT INTO registered_devices
        (email, device_token, platform, device_name, device_id, mode, is_active, tenant_id, subject_id)
    VALUES
        (lower(p_email), v_token, p_platform, p_device_name, p_device_id, p_mode,
         NOT v_conflict, v_tenant_id, v_subject);

    RETURN jsonb_build_object(
        'server_token', v_token,
        'conflict', v_conflict,
        'conflicting_device_name', v_latest_name,
        'conflicting_last_seen',   v_latest_seen,
        'max_devices', v_max,
        'active_devices', COALESCE(v_list, '[]'::jsonb)
    );
END;
$$;

-- ── transfer_to_device ──────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS transfer_to_device(text, text, text);
CREATE OR REPLACE FUNCTION transfer_to_device(
    p_server_token     TEXT,
    p_new_device_token TEXT,
    p_api_key          TEXT DEFAULT NULL,
    p_replace_device   TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_email     TEXT;
    v_mode      TEXT;
    v_max       INT;
    v_active    INT;
    v_rows      INT;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    IF v_email IS NULL THEN
        RETURN jsonb_build_object('transferred', false, 'reason', 'invalid_token');
    END IF;
    IF p_server_token != p_new_device_token THEN
        IF NOT EXISTS (
            SELECT 1 FROM registered_devices
            WHERE device_token = p_new_device_token
              AND lower(email) = lower(v_email)
              AND mode = v_mode
              AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
        ) THEN
            RETURN jsonb_build_object('transferred', false, 'reason', 'new_token_not_found');
        END IF;
    END IF;
    SELECT COALESCE(max_active_devices, 1) INTO v_max FROM tenants WHERE id = v_tenant_id;
    v_max := COALESCE(v_max, 1);

    IF p_replace_device IS NOT NULL THEN
        -- Sign out exactly the device the buyer chose — only ever one of THIS account's active devices.
        UPDATE registered_devices
        SET is_active = false, revoked_at = now(), revoked_by = 'transfer'
        WHERE id::text = p_replace_device
          AND lower(email) = lower(v_email)
          AND mode = v_mode
          AND is_active = true
          AND device_token != p_new_device_token
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
        IF NOT FOUND THEN
            RETURN jsonb_build_object('transferred', false, 'reason', 'replace_not_found');
        END IF;
    END IF;

    -- Make room: sign out the least-recently-seen devices until the new one fits the limit. With a
    -- choice above this is normally a no-op; with no choice and a limit of 1 it is the old "all others".
    SELECT count(*) INTO v_active
    FROM registered_devices
    WHERE lower(email) = lower(v_email) AND mode = v_mode AND is_active = true
      AND device_token != p_new_device_token
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    IF v_active >= v_max THEN
        UPDATE registered_devices
        SET is_active = false, revoked_at = now(), revoked_by = 'transfer'
        WHERE id IN (
            SELECT id FROM registered_devices
            WHERE lower(email) = lower(v_email) AND mode = v_mode AND is_active = true
              AND device_token != p_new_device_token
              AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
            ORDER BY COALESCE(last_seen_at, registered_at) ASC
            LIMIT (v_active - v_max + 1)
        );
    END IF;

    UPDATE registered_devices
    SET is_active = true
    WHERE device_token = p_new_device_token
      AND lower(email) = lower(v_email)
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
    RETURNING 1 INTO v_rows;
    IF v_rows IS NULL THEN
        RETURN jsonb_build_object('transferred', false, 'reason', 'activation_failed');
    END IF;
    RETURN jsonb_build_object('transferred', true);
END;
$$;
-- Same surface as the signature it replaces (107's anon allowlist: SDK-facing, token-guarded).
REVOKE ALL ON FUNCTION transfer_to_device(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transfer_to_device(text, text, text, text) TO anon, authenticated, service_role;

-- ── Manage devices (get_active_devices + sign_out_device) ───────────────────────────────────────
-- A signed-in device lists the account's active devices and signs one out, any time — not only when a
-- new device hits the limit (the streaming-service "Manage devices" screen). The list names devices by
-- device_ref and NEVER returns their tokens: a token is a capability, so handing a phone the browser's
-- token would let it act as the browser. That is also why the function can now be opened to the
-- publishable (anon) key, next to the other token-guarded SDK RPCs of 107's allowlist.
CREATE OR REPLACE FUNCTION get_active_devices(
    p_server_token TEXT,
    p_api_key      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_email     TEXT;
    v_mode      TEXT;
    v_max       INT;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    IF v_email IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;
    SELECT COALESCE(max_active_devices, 1) INTO v_max FROM tenants WHERE id = v_tenant_id;
    RETURN COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
            'device_ref',    id::text,
            'this_device',   device_token = p_server_token,
            -- the account's seat count, the same on every row (the list stays a plain array)
            'max_devices',   COALESCE(v_max, 1),
            'platform',      platform,
            'device_name',   device_name,
            'registered_at', registered_at,
            'last_seen_at',  last_seen_at
        ) ORDER BY (device_token = p_server_token) DESC, COALESCE(last_seen_at, registered_at) DESC)
        FROM registered_devices
        WHERE lower(email) = lower(v_email)
          AND mode         = v_mode
          AND is_active    = true
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
    ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION get_active_devices(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_devices(text, text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION sign_out_device(
    p_server_token TEXT,
    p_device_ref   TEXT,
    p_api_key      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_email     TEXT;
    v_mode      TEXT;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);
    -- Only an ACTIVE device of the account may sign devices out (itself included).
    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    IF v_email IS NULL THEN
        RETURN jsonb_build_object('signed_out', false, 'reason', 'invalid_token');
    END IF;
    UPDATE registered_devices
    SET is_active = false, revoked_at = now(), revoked_by = 'user'
    WHERE id::text = p_device_ref
      AND lower(email) = lower(v_email)
      AND mode = v_mode
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    IF NOT FOUND THEN
        RETURN jsonb_build_object('signed_out', false, 'reason', 'device_not_found');
    END IF;
    RETURN jsonb_build_object('signed_out', true);
END;
$$;
REVOKE ALL ON FUNCTION sign_out_device(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sign_out_device(text, text, text) TO anon, authenticated, service_role;
