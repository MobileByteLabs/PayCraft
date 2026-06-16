-- Migration 039: Make tenant_admins.user_id unique + provision_tenant idempotent
-- Fixes: concurrent RSC rendering calling provision_tenant twice creating duplicate rows.

-- 1. Clean up any duplicate tenant_admins rows (keep the first one per user)
DELETE FROM tenant_admins a USING tenant_admins b
WHERE a.ctid > b.ctid
  AND a.user_id = b.user_id;

-- 2. Add unique constraint on user_id (one tenant per user)
ALTER TABLE tenant_admins
  DROP CONSTRAINT IF EXISTS tenant_admins_user_id_key;

ALTER TABLE tenant_admins
  ADD CONSTRAINT tenant_admins_user_id_key UNIQUE (user_id);

-- 3. Replace provision_tenant with an idempotent version:
--    - If user already has a tenant row, return existing tenant data.
--    - If not, create tenant + admin row using ON CONFLICT DO NOTHING for safety.
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
    v_existing_tenant_id UUID;
BEGIN
    -- Idempotent guard: return existing tenant if already provisioned
    SELECT tenant_id INTO v_existing_tenant_id
    FROM tenant_admins
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_existing_tenant_id IS NOT NULL THEN
        RETURN (
            SELECT jsonb_build_object(
                'tenant_id', id,
                'api_key_test', api_key_test,
                'api_key_live', api_key_live,
                'webhook_url', format('/functions/v1/stripe-webhook/%s', id)
            )
            FROM tenants WHERE id = v_existing_tenant_id
        );
    END IF;

    -- Generate keys
    v_api_test := 'pk_test_' || encode(gen_random_bytes(24), 'hex');
    v_api_live := 'pk_live_' || encode(gen_random_bytes(24), 'hex');
    v_wh_test  := 'whsec_test_' || encode(gen_random_bytes(24), 'hex');
    v_wh_live  := 'whsec_live_' || encode(gen_random_bytes(24), 'hex');

    INSERT INTO tenants (name, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, owner_email, plan, subscriber_limit)
    VALUES (p_app_name, v_api_test, v_api_live, v_wh_test, v_wh_live, p_email, 'free', 100)
    RETURNING id INTO v_tenant_id;

    -- ON CONFLICT covers the race where two concurrent calls both passed the guard above
    INSERT INTO tenant_admins (tenant_id, user_id, role)
    VALUES (v_tenant_id, p_user_id, 'owner')
    ON CONFLICT (user_id) DO NOTHING;

    -- If the INSERT was a no-op (lost the race), read the winner's tenant
    IF NOT FOUND THEN
        SELECT tenant_id INTO v_tenant_id FROM tenant_admins WHERE user_id = p_user_id;
        -- Delete the orphan tenant we just created (no admin row pointing to it)
        DELETE FROM tenants WHERE id = v_tenant_id AND id NOT IN (SELECT tenant_id FROM tenant_admins);
    END IF;

    RETURN jsonb_build_object(
        'tenant_id', v_tenant_id,
        'api_key_test', v_api_test,
        'api_key_live', v_api_live,
        'webhook_url', format('/functions/v1/stripe-webhook/%s', v_tenant_id)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION provision_tenant(uuid, text, text) TO authenticated;
