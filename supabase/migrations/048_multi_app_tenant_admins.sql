-- Migration 048: Multi-app support — drop user_id unique constraint; add provision_app RPC.
-- Pairs with Phase 4 of paycraft-dashboard-provider-integration epic.

-- 1. Drop the single-tenant unique constraint (added in migration 039).
ALTER TABLE public.tenant_admins
  DROP CONSTRAINT IF EXISTS tenant_admins_user_id_key;

-- 2. Composite unique — one user can be an admin of many tenants, but only once per tenant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_admins_tenant_user_key'
      AND conrelid = 'public.tenant_admins'::regclass
  ) THEN
    ALTER TABLE public.tenant_admins
      ADD CONSTRAINT tenant_admins_tenant_user_key UNIQUE (tenant_id, user_id);
  END IF;
END $$;

-- 3. RPC: provision_app — create a new tenant owned by the calling user.
--    Returns tenant_id, name, api_key_test, api_key_live, webhook_url.
CREATE OR REPLACE FUNCTION provision_app(p_app_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id  UUID := auth.uid();
  v_email    TEXT;
  v_tenant_id UUID;
  v_api_test  TEXT := 'pk_test_' || encode(gen_random_bytes(24), 'hex');
  v_api_live  TEXT := 'pk_live_' || encode(gen_random_bytes(24), 'hex');
  v_wh_test   TEXT := 'whsec_test_' || encode(gen_random_bytes(24), 'hex');
  v_wh_live   TEXT := 'whsec_live_' || encode(gen_random_bytes(24), 'hex');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  INSERT INTO tenants (
    name, api_key_test, api_key_live,
    webhook_secret_test, webhook_secret_live,
    owner_email, plan, subscriber_limit
  ) VALUES (
    p_app_name, v_api_test, v_api_live,
    v_wh_test, v_wh_live,
    v_email, 'free', 100
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO tenant_admins (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_user_id, 'owner');

  RETURN jsonb_build_object(
    'tenant_id',    v_tenant_id,
    'name',         p_app_name,
    'api_key_test', v_api_test,
    'api_key_live', v_api_live,
    'webhook_url',  format('/functions/v1/stripe-webhook/%s', v_tenant_id)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION provision_app(TEXT) TO authenticated;

-- 4. RPC: tenant_admins_list_for_user — returns all tenant_id rows for the calling user.
CREATE OR REPLACE FUNCTION tenant_admins_list_for_user()
RETURNS TABLE (tenant_id UUID, role TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT ta.tenant_id, ta.role::TEXT
  FROM tenant_admins ta
  WHERE ta.user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION tenant_admins_list_for_user() TO authenticated;
