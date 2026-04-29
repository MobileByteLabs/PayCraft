-- Migration 015: Add tenant_id to subscriptions + registered_devices
-- Enables multi-tenant isolation: each tenant's data is scoped.
--
-- BACKWARD COMPAT: tenant_id DEFAULT NULL → self-hosted users
-- with no tenants table rows continue to work (NULL = single-tenant mode).
-- Unique constraints change from (email) → (tenant_id, email).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. subscriptions: add tenant_id
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) DEFAULT NULL;

-- Drop old unique index on email alone
DROP INDEX IF EXISTS idx_subscriptions_email;

-- New unique constraint: (tenant_id, email) — NULL tenant_id groups all self-hosted rows
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_tenant_email
    ON public.subscriptions (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), email);

-- Fast lookup by tenant
CREATE INDEX IF NOT EXISTS idx_subscriptions_tenant_id
    ON public.subscriptions(tenant_id) WHERE tenant_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. registered_devices: add tenant_id
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.registered_devices
    ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) DEFAULT NULL;

-- Fast lookup by tenant
CREATE INDEX IF NOT EXISTS idx_regdev_tenant_id
    ON public.registered_devices(tenant_id) WHERE tenant_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Helper: resolve API key → tenant_id
--    Called by pre-request logic or directly by RPCs.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION resolve_tenant(p_api_key TEXT)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    IF p_api_key IS NULL OR p_api_key = '' THEN
        RETURN NULL;  -- No API key = single-tenant (self-hosted) mode
    END IF;

    -- Check test keys first (pk_test_*), then live keys (pk_live_*)
    SELECT id INTO v_tenant_id
    FROM tenants
    WHERE (api_key_test = p_api_key OR api_key_live = p_api_key)
      AND status = 'active'
    LIMIT 1;

    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Invalid or inactive API key';
    END IF;

    RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_tenant(text) TO anon, authenticated;
