-- PayCraft: Add mode column to subscriptions
-- Separates test (sandbox) rows from live (production) rows.
-- mode = 'test'  → created via sk_test_ key (Stripe sandbox)
-- mode = 'live'  → created via sk_live_ key (Stripe production)
-- Existing rows default to 'live' (backward-compatible).

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'live';

CREATE INDEX IF NOT EXISTS idx_subscriptions_mode
    ON public.subscriptions(mode);

COMMENT ON COLUMN public.subscriptions.mode IS
    'Stripe mode: test (sandbox sk_test_) or live (production sk_live_). Prevents test rows from affecting isPremium() in production.';
