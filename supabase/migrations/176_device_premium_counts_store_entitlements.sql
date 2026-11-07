-- 176 — a signed-in device's premium check counts STORE entitlements, not only PSP subscriptions.
--
-- is_premium / check_premium_with_device (155) answered only from `subscriptions`, where Stripe,
-- Razorpay and the other PSP webhooks land. Google Play and App Store purchases are reconciled into
-- `entitlement_records` instead. So a signed-in user who bought through a store got
-- {is_premium:false}, and the SDK's applyPremiumResult downgraded them to Free — overwriting the
-- correct store answer it had just read.
--
-- Measured on mbs/reels-downloader 2026-11-07 (physical Android, license-tester purchase):
--   register_play_purchase → state=active · get_entitlements → state=active provider=google_play
--   check_premium_with_device → isPremium=false → applyPremiumResult(false) → app shows "Free"
--
-- Fix: one helper both RPCs share. A store entitlement counts when it belongs to the same tenant,
-- is held by the device's email (app_user_id is the email once signed in), is in a premium canonical
-- state (the SDK's own set: trial · active · active_non_renewing · in_grace_period), and has not
-- expired (expires_at, or in_grace_until for a grace period). Freshness without RTDN: the SDK
-- re-registers held store purchases on foreground, which re-fetches truth from the store and
-- rewrites expires_at — so a renewal is reflected even when no notification arrived.
--
-- Mode: store purchases carry is_sandbox, not test/live. A license-tester purchase is sandbox in
-- every build, so sandbox is accepted in both modes — the store itself validated the token, and
-- refusing sandbox in live mode would lock QA testers out of release builds.

CREATE OR REPLACE FUNCTION public._store_entitlement_premium(p_tenant_id UUID, p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM entitlement_records e
     WHERE e.tenant_id IS NOT DISTINCT FROM p_tenant_id
       AND lower(e.app_user_id) = lower(p_email)
       AND e.canonical_state IN ('trial', 'active', 'active_non_renewing', 'in_grace_period')
       AND (e.expires_at IS NULL OR e.expires_at > now()
            OR (e.in_grace_until IS NOT NULL AND e.in_grace_until > now()))
  );
$$;
REVOKE EXECUTE ON FUNCTION public._store_entitlement_premium(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION is_premium(
    p_server_token TEXT,
    p_api_key      TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_email     TEXT;
    v_mode      TEXT;
    v_subject   UUID;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);

    SELECT email, mode, subject_id INTO v_email, v_mode, v_subject
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);

    IF v_email IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE ((v_subject IS NOT NULL AND s.subject_id = v_subject) OR s.email = lower(v_email))
          AND s.status IN ('active', 'trialing')
          AND s.mode = v_mode
          AND s.current_period_end > now()
          AND (s.tenant_id IS NOT DISTINCT FROM v_tenant_id)
    ) OR public._store_entitlement_premium(v_tenant_id, v_email);
END;
$$;

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

    RETURN jsonb_build_object('is_premium', v_is_premium, 'token_valid', true);
END;
$$;

GRANT EXECUTE ON FUNCTION is_premium(text, text)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_premium_with_device(text, text) TO anon, authenticated;
