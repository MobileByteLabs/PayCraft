-- Migration 019: Tenant Plan Pricing
-- Server-side pricing enables MRR calculation without client-side amounts.

CREATE TABLE IF NOT EXISTS public.tenant_plan_prices (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    plan_id     TEXT        NOT NULL,          -- matches subscriptions.plan
    amount_cents INT        NOT NULL,          -- 499 = $4.99
    currency    TEXT        NOT NULL DEFAULT 'usd',
    interval    TEXT        NOT NULL DEFAULT 'month'
                CHECK (interval IN ('month', 'year', 'week', 'day')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, plan_id)
);

ALTER TABLE public.tenant_plan_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_plan_prices_service_role"
    ON public.tenant_plan_prices FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

COMMENT ON TABLE public.tenant_plan_prices IS 'PayCraft: plan pricing per tenant for MRR analytics';
