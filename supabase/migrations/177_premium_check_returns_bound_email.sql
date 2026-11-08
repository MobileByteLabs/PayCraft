-- 177 — check_premium_with_device says WHICH identity the token answers for.
--
-- A device token is bound to the email it was registered with. When the user signs in as a
-- different account on the same device (Restore → Google sign-in), the SDK kept the old token, so
-- every premium check answered for the PREVIOUS account. Measured on mbs/reels-downloader
-- 2026-11-07: device token registered to rajanmaurya154@…, SDK identity mobilebytesensei@…, an
-- active Play purchase under mobilebytesensei@… → app showed "Free".
--
-- Returning the bound email lets the SDK detect the mismatch and re-register the device for the
-- signed-in identity. Additive: older SDKs ignore the extra key. The caller already holds the
-- token, so the email is not new information to it.

CREATE OR REPLACE FUNCTION check_premium_with_device(
    p_server_token TEXT,
    p_api_key      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id  UUID;
    v_email      TEXT;
    v_mode       TEXT;
    v_subject    UUID;
    v_is_premium BOOLEAN;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);

    UPDATE registered_devices
    SET last_seen_at = now()
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
    RETURNING email, mode, subject_id INTO v_email, v_mode, v_subject;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('is_premium', false, 'token_valid', false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE ((v_subject IS NOT NULL AND s.subject_id = v_subject) OR s.email = lower(v_email))
          AND s.status IN ('active', 'trialing')
          AND s.mode = v_mode
          AND s.current_period_end > now()
          AND (s.tenant_id IS NOT DISTINCT FROM v_tenant_id)
    ) OR public._store_entitlement_premium(v_tenant_id, v_email) INTO v_is_premium;

    RETURN jsonb_build_object('is_premium', v_is_premium, 'token_valid', true, 'email', lower(v_email));
END;
$$;

GRANT EXECUTE ON FUNCTION check_premium_with_device(text, text) TO anon, authenticated;
