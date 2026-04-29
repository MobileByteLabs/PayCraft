-- Migration 014: Tenant Registry
-- Foundation for multi-tenant PayCraft Cloud.
-- Self-hosted users: this table exists but is empty (single-tenant mode).

CREATE TABLE IF NOT EXISTS public.tenants (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT        NOT NULL,
    -- API keys: pk_test_* / pk_live_* prefixed, used by SDK
    api_key_test    TEXT        NOT NULL UNIQUE,
    api_key_live    TEXT        NOT NULL UNIQUE,
    -- Webhook secrets per mode (used by Edge Functions to route/verify)
    webhook_secret_test TEXT,
    webhook_secret_live TEXT,
    -- Tenant status
    status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'churned')),
    -- Billing tier (for PayCraft Cloud billing)
    plan            TEXT        NOT NULL DEFAULT 'free'
                    CHECK (plan IN ('free', 'pro', 'enterprise')),
    subscriber_limit INT       NOT NULL DEFAULT 100,
    -- Contact
    owner_email     TEXT        NOT NULL,
    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: service_role only — tenants table is never exposed to SDK clients
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_only_tenants"
    ON public.tenants FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- Index for API key lookups (used by pre-request tenant resolution)
CREATE INDEX IF NOT EXISTS idx_tenants_api_key_test ON public.tenants(api_key_test);
CREATE INDEX IF NOT EXISTS idx_tenants_api_key_live ON public.tenants(api_key_live);

COMMENT ON TABLE public.tenants IS 'PayCraft Cloud: tenant registry for multi-tenant billing';
