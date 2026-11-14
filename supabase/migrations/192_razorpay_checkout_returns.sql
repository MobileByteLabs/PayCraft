-- 192_razorpay_checkout_returns.sql
--
-- Where a Razorpay subscription buyer returns to after paying.
--
-- Razorpay's hosted subscription page (short_url) cannot redirect, so a web buyer who paid stayed on
-- razorpay.com (ReelExport, 2026-11-13). Stripe returns buyers through success_url. checkout-initiate now
-- stores the validated return URLs here (same-origin https, the rules Stripe's return_url follows) and
-- sends the buyer to the dashboard's /pay/razorpay/{subscription_id}, which opens Razorpay Checkout over
-- the subscription and redirects to success_url / cancel_url from THIS row — never from the link, so the
-- page cannot be used to redirect anywhere else.
--
-- Service role only: RLS on, no policies. key_id is Razorpay's PUBLIC key id (Checkout needs it in the
-- browser); no secret is stored.

CREATE TABLE IF NOT EXISTS public.razorpay_checkout_returns (
  subscription_id TEXT        PRIMARY KEY CHECK (subscription_id ~ '^sub_[A-Za-z0-9]{6,40}$'),
  tenant_id       UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  mode            TEXT        NOT NULL CHECK (mode IN ('live', 'test')),
  key_id          TEXT        NOT NULL CHECK (key_id ~ '^rzp_(live|test)_[A-Za-z0-9]+$'),
  success_url     TEXT        NOT NULL CHECK (success_url ~ '^https?://'),
  cancel_url      TEXT        NOT NULL CHECK (cancel_url ~ '^https?://'),
  short_url       TEXT        NOT NULL,
  email           TEXT,
  product_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS razorpay_checkout_returns_created_at_idx
  ON public.razorpay_checkout_returns (created_at);

ALTER TABLE public.razorpay_checkout_returns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.razorpay_checkout_returns FROM anon, authenticated;
