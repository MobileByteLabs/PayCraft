-- Migration 052 — Razorpay Offer ID column on tenant_coupons.
-- Populated by lib/razorpay-coupon-sync.ts when a tenant_coupon is saved
-- and the tenant has a connected Razorpay provider. The SDK reads this so
-- it can append `?offer_id=…` to Razorpay subscription links at checkout.

ALTER TABLE public.tenant_coupons
  ADD COLUMN IF NOT EXISTS razorpay_offer_id TEXT;

COMMENT ON COLUMN public.tenant_coupons.razorpay_offer_id IS
  'Auto-populated by Razorpay sync when a coupon is created and the tenant has a Razorpay provider. NULL when sync was skipped (no connection) or failed.';
