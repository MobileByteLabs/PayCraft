-- 199 — name Reels Downloader's live subscriptions by their catalogue SKU (2026-11-17).
--
-- THE BUG
-- Plan grants (196) and plan changes (197, subscription-change) look a subscription's plan up as a
-- tenant_products.sku. Reels Downloader's Stripe subscriptions predate the SKU convention (179) and were
-- stored as `monthly` / `yearly`, and one as a raw Stripe price id (`price_1TQMR2…`, from an older Stripe
-- catalogue no current product owns — the webhook fell back to the price id when no plan_id metadata
-- existed; stripe-webhook now asks the catalogue first). None of those match a SKU, so those paying
-- subscribers could not change plan and got the fallback grant.
--
-- THE MAPPING (Reels Downloader tenant only)
--   monthly                          → pro-monthly
--   yearly                           → pro-annual
--   price_1TQMR2JxFAL0O3DKX3fo5vDg   → pro-quarterly  (its billing period is 2026-10-17 → 2027-01-17: 3 months)
-- No code reads the old names (checked: the Reels Downloader app and PayCraft functions).
--
-- Idempotent: only rows still carrying an old name change; re-running is a no-op.

UPDATE subscriptions
SET plan = CASE plan
             WHEN 'monthly' THEN 'pro-monthly'
             WHEN 'yearly' THEN 'pro-annual'
             WHEN 'price_1TQMR2JxFAL0O3DKX3fo5vDg' THEN 'pro-quarterly'
           END,
    updated_at = now()
WHERE tenant_id = 'bba1842f-3a57-41cd-8705-94db588de056'
  AND plan IN ('monthly', 'yearly', 'price_1TQMR2JxFAL0O3DKX3fo5vDg');
