-- 200 — register_device reuses a device's PENDING row instead of adding one per attempt (2026-11-17).
--
-- THE BUG
-- When a sign-in hits tenants.max_active_devices, register_device inserts a pending row (is_active = false)
-- and returns conflict = true; the row activates only if the member resolves the conflict. Nothing reused
-- that row, so every further attempt from the same device — every launch, and every SDK re-registration
-- after a failed token check — inserted another. Production: one Reels Downloader member, 2 phones,
-- 44 rows (35 pending, never activated).
--
-- THE FIX
-- 193's register_device body, unchanged except: on conflict, an existing pending, non-revoked row for the
-- same (subject|email, tenant, mode, device_name, platform) is returned with its token. Grants are kept by
-- CREATE OR REPLACE. Leftover pending rows are left alone (harmless, never active).

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
        PERFORM _apply_verified_sign_in(v_tenant_id, p_device_id, p_email, v_same);
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

    -- 200: a sign-in that hits the device limit leaves a PENDING row (is_active = false) until the member
    -- resolves the conflict. The same device trying again must reuse that row, not add another — one
    -- Reels Downloader member collected 35 pending rows from 2 phones (2026-11-17).
    IF v_conflict THEN
        SELECT device_token INTO v_token
        FROM registered_devices
        WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
          AND mode = p_mode
          AND is_active = false
          AND revoked_at IS NULL
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
          AND device_name IS NOT DISTINCT FROM p_device_name
          AND platform = p_platform
        ORDER BY registered_at DESC
        LIMIT 1;
        IF v_token IS NOT NULL THEN
            UPDATE registered_devices SET device_id = COALESCE(p_device_id, device_id) WHERE device_token = v_token;
            PERFORM _apply_verified_sign_in(v_tenant_id, p_device_id, p_email, v_token);
            RETURN jsonb_build_object(
                'server_token', v_token,
                'conflict', true,
                'conflicting_device_name', v_latest_name,
                'conflicting_last_seen',   v_latest_seen,
                'max_devices', v_max,
                'active_devices', COALESCE(v_list, '[]'::jsonb)
            );
        END IF;
    END IF;

    v_token := 'srv_' || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO registered_devices
        (email, device_token, platform, device_name, device_id, mode, is_active, tenant_id, subject_id)
    VALUES
        (lower(p_email), v_token, p_platform, p_device_name, p_device_id, p_mode,
         NOT v_conflict, v_tenant_id, v_subject);

    PERFORM _apply_verified_sign_in(v_tenant_id, p_device_id, p_email, v_token);

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
