-- 203 — a store entitlement only makes a device premium in its OWN mode (2026-11-17).
--
-- THE BUG
-- check_premium_with_device / is_premium match subscriptions on `s.mode = v_mode` (the device's mode), but the
-- store-entitlement path (176: _store_entitlement_premium) ignored entitlement_records.is_sandbox. A SANDBOX
-- entitlement therefore made a LIVE device premium: the ReelExport owner's account showed Pro on the live site
-- from a Razorpay test-mode trial (2026-11-17). The same hole lets a live store purchase make a test device Pro.
--
-- THE FIX
-- _store_entitlement_premium_in_mode(tenant, email, mode): mode 'test' counts only sandbox records, any other
-- mode only real ones. Both callers pass the device's mode; their bodies are otherwise unchanged (copied from the
-- live definitions). The 2-argument helper stays for anything outside this schema that still calls it.
-- Idempotent: CREATE OR REPLACE; grants restated.

CREATE OR REPLACE FUNCTION public._store_entitlement_premium_in_mode(p_tenant_id uuid, p_email text, p_mode text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM entitlement_records e
     WHERE e.tenant_id IS NOT DISTINCT FROM p_tenant_id
       AND lower(e.app_user_id) = lower(p_email)
       AND e.is_sandbox = (p_mode = 'test')
       AND e.canonical_state IN ('trial', 'active', 'active_non_renewing', 'in_grace_period')
       AND (e.expires_at IS NULL OR e.expires_at > now()
            OR (e.in_grace_until IS NOT NULL AND e.in_grace_until > now()))
  );
$$;
REVOKE ALL ON FUNCTION public._store_entitlement_premium_in_mode(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_premium(p_server_token text, p_api_key text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    ) OR public._store_entitlement_premium_in_mode(v_tenant_id, v_email, v_mode);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_premium_with_device(p_server_token text, p_api_key text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
    ) OR public._store_entitlement_premium_in_mode(v_tenant_id, v_email, v_mode) INTO v_is_premium;

    RETURN jsonb_build_object('is_premium', v_is_premium, 'token_valid', true, 'email', lower(v_email));
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_premium(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.check_premium_with_device(text, text) TO anon, authenticated, service_role;
