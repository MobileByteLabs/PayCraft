-- PayCraft: Subscriptions table
-- Provider-agnostic — works with Stripe, Razorpay, or any payment provider

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    email text NOT NULL,
    provider text NOT NULL DEFAULT 'stripe',
    provider_customer_id text,
    provider_subscription_id text,
    plan text NOT NULL DEFAULT 'monthly',
    status text NOT NULL DEFAULT 'active',
    current_period_start timestamptz,
    current_period_end timestamptz,
    cancel_at_period_end boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_email
    ON public.subscriptions(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_stripe_id
    ON public.subscriptions(provider_subscription_id)
    WHERE provider_subscription_id IS NOT NULL;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read subscriptions"
    ON public.subscriptions FOR SELECT USING (true);
CREATE POLICY "Service role manages subscriptions"
    ON public.subscriptions FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.subscriptions IS 'PayCraft: subscription status synced via payment provider webhooks';
