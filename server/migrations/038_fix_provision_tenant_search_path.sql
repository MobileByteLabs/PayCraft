-- Migration 038: Fix provision_tenant + rotate_api_key search_path
-- gen_random_bytes() lives in the `extensions` schema (pgcrypto).
-- SECURITY DEFINER functions with SET search_path = public can't see it.
-- Fix: include extensions in the search path for all affected functions.

CREATE OR REPLACE FUNCTION provision_tenant(
    p_user_id    UUID,
    p_app_name   TEXT,
    p_email      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_tenant_id  UUID;
    v_api_test   TEXT;
    v_api_live   TEXT;
    v_wh_test    TEXT;
    v_wh_live    TEXT;
BEGIN
    v_api_test := 'pk_test_' || encode(gen_random_bytes(24), 'hex');
    v_api_live := 'pk_live_' || encode(gen_random_bytes(24), 'hex');
    v_wh_test  := 'whsec_test_' || encode(gen_random_bytes(24), 'hex');
    v_wh_live  := 'whsec_live_' || encode(gen_random_bytes(24), 'hex');

    INSERT INTO tenants (name, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, owner_email, plan, subscriber_limit)
    VALUES (p_app_name, v_api_test, v_api_live, v_wh_test, v_wh_live, p_email, 'free', 100)
    RETURNING id INTO v_tenant_id;

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

CREATE OR REPLACE FUNCTION rotate_api_key(
    p_user_id UUID,
    p_mode    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_tenant_id UUID;
    v_new_key   TEXT;
BEGIN
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

GRANT EXECUTE ON FUNCTION provision_tenant(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION rotate_api_key(uuid, text) TO authenticated;
