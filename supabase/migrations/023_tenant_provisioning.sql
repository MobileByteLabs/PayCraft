-- Migration 023: Tenant Provisioning RPCs
-- Auto-provisions a tenant when a user signs up on the dashboard.
-- Generates API keys, creates tenant_admins link, and provides key rotation.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. provision_tenant — called after Supabase Auth sign-up
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION provision_tenant(
    p_user_id    UUID,
    p_app_name   TEXT,
    p_email      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id  UUID;
    v_api_test   TEXT;
    v_api_live   TEXT;
    v_wh_test    TEXT;
    v_wh_live    TEXT;
BEGIN
    -- Generate API keys with prefixes
    v_api_test := 'pk_test_' || encode(gen_random_bytes(24), 'hex');
    v_api_live := 'pk_live_' || encode(gen_random_bytes(24), 'hex');
    v_wh_test  := 'whsec_test_' || encode(gen_random_bytes(24), 'hex');
    v_wh_live  := 'whsec_live_' || encode(gen_random_bytes(24), 'hex');

    -- Create tenant
    INSERT INTO tenants (name, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, owner_email, plan, subscriber_limit)
    VALUES (p_app_name, v_api_test, v_api_live, v_wh_test, v_wh_live, p_email, 'free', 100)
    RETURNING id INTO v_tenant_id;

    -- Link user as owner
    INSERT INTO tenant_admins (tenant_id, user_id, role)
    VALUES (v_tenant_id, p_user_id, 'owner');

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'api_key_test', v_api_test,
        'api_key_live', v_api_live,
        'webhook_url', format('/functions/v1/stripe-webhook/%s', v_tenant_id)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION provision_tenant(uuid, text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. rotate_api_key — rotates test or live API key
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION rotate_api_key(
    p_user_id UUID,
    p_mode    TEXT  -- 'test' or 'live'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_new_key   TEXT;
BEGIN
    -- Verify user is owner/admin
    SELECT ta.tenant_id INTO v_tenant_id
    FROM tenant_admins ta
    WHERE ta.user_id = p_user_id
      AND ta.role IN ('owner', 'admin');

    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('error', 'unauthorized');
    END IF;

    v_new_key := 'pk_' || p_mode || '_' || encode(gen_random_bytes(24), 'hex');

    IF p_mode = 'test' THEN
        UPDATE tenants SET api_key_test = v_new_key, updated_at = now() WHERE id = v_tenant_id;
    ELSIF p_mode = 'live' THEN
        UPDATE tenants SET api_key_live = v_new_key, updated_at = now() WHERE id = v_tenant_id;
    ELSE
        RETURN jsonb_build_object('error', 'invalid mode, use test or live');
    END IF;

    RETURN jsonb_build_object('new_key', v_new_key, 'mode', p_mode);
END;
$$;

GRANT EXECUTE ON FUNCTION rotate_api_key(uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. get_tenant_usage — subscriber count + limit for metering
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_tenant_usage(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id       UUID;
    v_plan            TEXT;
    v_limit           INT;
    v_active_count    INT;
    v_total_count     INT;
    v_test_count      INT;
BEGIN
    SELECT ta.tenant_id INTO v_tenant_id
    FROM tenant_admins ta
    WHERE ta.user_id = p_user_id;

    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('error', 'no_tenant');
    END IF;

    SELECT plan, subscriber_limit INTO v_plan, v_limit
    FROM tenants WHERE id = v_tenant_id;

    -- Live active subscribers (count toward limit)
    SELECT COUNT(*) INTO v_active_count
    FROM subscriptions
    WHERE tenant_id = v_tenant_id
      AND mode = 'live'
      AND status IN ('active', 'trialing')
      AND current_period_end > now();

    -- Total live subscribers (all statuses)
    SELECT COUNT(*) INTO v_total_count
    FROM subscriptions
    WHERE tenant_id = v_tenant_id AND mode = 'live';

    -- Test subscribers (no limit)
    SELECT COUNT(*) INTO v_test_count
    FROM subscriptions
    WHERE tenant_id = v_tenant_id AND mode = 'test';

    RETURN jsonb_build_object(
        'plan', v_plan,
        'subscriber_limit', v_limit,
        'active_subscribers', v_active_count,
        'total_subscribers', v_total_count,
        'test_subscribers', v_test_count,
        'usage_percent', CASE WHEN v_limit > 0 THEN round((v_active_count::numeric / v_limit) * 100, 1) ELSE 0 END,
        'at_limit', v_active_count >= v_limit
    );
END;
$$;

GRANT EXECUTE ON FUNCTION get_tenant_usage(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Subscriber limit enforcement in register_device
--    Reject new registrations when tenant is at capacity (live mode only)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_subscriber_limit(p_tenant_id UUID, p_email TEXT, p_mode TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_limit INT;
    v_count INT;
BEGIN
    -- Test mode: no limits
    IF p_mode = 'test' OR p_tenant_id IS NULL THEN
        RETURN true;
    END IF;

    -- Check if this email already has a subscription (not a new subscriber)
    IF EXISTS (
        SELECT 1 FROM subscriptions
        WHERE tenant_id = p_tenant_id AND lower(email) = lower(p_email) AND mode = 'live'
    ) THEN
        RETURN true;  -- Existing subscriber, always allowed
    END IF;

    SELECT subscriber_limit INTO v_limit FROM tenants WHERE id = p_tenant_id;

    SELECT COUNT(DISTINCT email) INTO v_count
    FROM subscriptions
    WHERE tenant_id = p_tenant_id
      AND mode = 'live'
      AND status IN ('active', 'trialing');

    RETURN v_count < v_limit;
END;
$$;
