-- Migration 063 — single canonical `razorpay` method in the registry.
--
-- Razorpay's hosted checkout shows the customer ALL payment options
-- (cards, UPI, netbanking, wallets) on one page. There is no way for
-- PayCraft to pre-pick "UPI only" or "card only" with the Payment Link
-- API, so modelling them as separate registry methods just creates
-- routing knobs that don't actually do anything at runtime.
--
-- This migration replaces the two seeded rows with one canonical
-- `razorpay` method. Fee is the typical blend median (~1.5%); displays in
-- the dashboard as "Razorpay" without per-method confusion.

INSERT INTO public.provider_method_registry
  (method, display_name, provider, supports_one_time, supports_subscription,
   supported_countries, supported_currencies, fee_percent, fee_fixed_cents,
   cross_border_markup_percent, notes)
VALUES
  ('razorpay', 'Razorpay', 'razorpay', true, true,
   '{IN}', '{INR}', 1.5, 0, 0,
   'Razorpay hosted checkout — customer picks UPI / card / netbanking / wallet at checkout time. Fee varies by method (UPI ~0.5%, domestic card ~2%, intl card ~3%); 1.5% is the typical-blend median. Subscriptions supported across all methods including UPI Autopay.')
ON CONFLICT (method) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      fee_percent = EXCLUDED.fee_percent,
      supports_one_time = EXCLUDED.supports_one_time,
      supports_subscription = EXCLUDED.supports_subscription,
      supported_countries = EXCLUDED.supported_countries,
      supported_currencies = EXCLUDED.supported_currencies,
      notes = EXCLUDED.notes;

DELETE FROM public.provider_method_registry
WHERE method IN ('razorpay_upi', 'razorpay_card');
