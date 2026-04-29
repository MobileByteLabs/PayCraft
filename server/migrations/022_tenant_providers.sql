-- Migration 022: Tenant Provider Configuration
-- Stores provider keys per tenant. Secret keys are encrypted via pgcrypto.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tenant_providers (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    provider                TEXT        NOT NULL,  -- 'stripe', 'razorpay', etc.
    -- Encrypted fields (AES-256-GCM via pgcrypto)
    test_secret_key_enc     BYTEA,
    live_secret_key_enc     BYTEA,
    test_webhook_secret_enc BYTEA,
    live_webhook_secret_enc BYTEA,
    -- Non-sensitive config (payment links are public URLs)
    test_payment_links      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    live_payment_links      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_active               BOOLEAN     NOT NULL DEFAULT true,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, provider)
);

ALTER TABLE public.tenant_providers ENABLE ROW LEVEL SECURITY;

-- Only service_role can read/write (keys are never exposed to SDK)
CREATE POLICY "tenant_providers_service_role"
    ON public.tenant_providers FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- Helper: encrypt a key
CREATE OR REPLACE FUNCTION encrypt_provider_key(p_key TEXT)
RETURNS BYTEA
LANGUAGE sql SECURITY DEFINER
AS $$
    SELECT pgp_sym_encrypt(p_key, current_setting('app.encryption_key'));
$$;

-- Helper: decrypt a key (returns last 4 chars for masked display)
CREATE OR REPLACE FUNCTION decrypt_provider_key_masked(p_enc BYTEA)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER
AS $$
    SELECT '...' || right(pgp_sym_decrypt(p_enc, current_setting('app.encryption_key')), 4);
$$;

-- Helper: full decrypt (used only by webhook Edge Functions)
CREATE OR REPLACE FUNCTION decrypt_provider_key(p_enc BYTEA)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER
AS $$
    SELECT pgp_sym_decrypt(p_enc, current_setting('app.encryption_key'));
$$;

COMMENT ON TABLE public.tenant_providers IS 'PayCraft: provider keys per tenant (encrypted at rest)';
