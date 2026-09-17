-- Migration 024: PayCraft Cloud Billing
-- Tracks tenant billing state — Stripe subscription for PayCraft Cloud itself.

ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS billing_period_end TIMESTAMPTZ;

-- When a tenant upgrades, update their plan + limits
CREATE OR REPLACE FUNCTION upgrade_tenant_plan(
    p_tenant_id           UUID,
    p_plan                TEXT,
    p_subscriber_limit    INT,
    p_stripe_customer_id  TEXT DEFAULT NULL,
    p_stripe_sub_id       TEXT DEFAULT NULL,
    p_period_end          TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE tenants SET
        plan = p_plan,
        subscriber_limit = p_subscriber_limit,
        stripe_customer_id = COALESCE(p_stripe_customer_id, stripe_customer_id),
        stripe_subscription_id = COALESCE(p_stripe_sub_id, stripe_subscription_id),
        billing_period_end = COALESCE(p_period_end, billing_period_end),
        updated_at = now()
    WHERE id = p_tenant_id;
END;
$$;

-- Index for Stripe webhook lookups
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer
    ON public.tenants(stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;
