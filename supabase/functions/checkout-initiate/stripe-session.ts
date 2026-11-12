// supabase/functions/checkout-initiate/stripe-session.ts
//
// The Stripe lane of checkout-initiate, kept free of I/O so it is testable on its own.
//
// A web buyer is routed by DATA, not by country rules in code: /config prices them for their region
// (resolved_price.currency) and binds each product to the first provider in the tenant's routing chain
// that can charge that currency (store_binding). When that provider is Stripe and there is no payment
// link, the SDK posts here with provider=stripe and this lane opens a per-customer Checkout Session.
//
// RECONCILIATION IS ALREADY WIRED: stripe-webhook grants the plan from `session.metadata.plan_id` on
// checkout.session.completed and reads the buyer from `customer_email`, so the session carries both.

/** The id for [currency] in a per-currency map; the only entry when there is exactly one; else an error. */
export function pickByCurrency(
  map: Record<string, string> | null | undefined,
  currency: string | null,
  what: string,
): { id: string; currency: string } | { error: string } {
  const entries = Object.entries(map ?? {}).filter(([, v]) => typeof v === "string" && v.trim().length > 0)
  const wanted = currency?.toUpperCase() ?? null
  const hit = wanted ? entries.find(([k]) => k.toUpperCase() === wanted) : undefined
  if (hit) return { id: hit[1], currency: hit[0].toUpperCase() }
  if (entries.length === 1) return { id: entries[0][1], currency: entries[0][0].toUpperCase() }
  return {
    error: `no ${what} for currency ${currency ?? "(unspecified)"} — ` +
      (entries.length ? `configured: ${entries.map(([k]) => k).join(", ")}` : "none configured; sync the product"),
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"])

/**
 * Where Stripe sends the buyer back: the page they bought from, tagged `paycraft_checkout=success|cancel`.
 *
 * Only an https page (http on localhost) on the CALLING site is accepted — the request's Origin — so a
 * leaked publishable key cannot turn this endpoint into a redirect to someone else's page.
 */
export function returnUrls(
  returnUrl: string | null,
  origin: string | null,
): { success: string; cancel: string } | { error: string } {
  if (!returnUrl || !origin) return { error: "return_url and a browser Origin are required for a Stripe checkout" }
  let url: URL
  try {
    url = new URL(returnUrl)
  } catch {
    return { error: "return_url is not a valid URL" }
  }
  if (url.origin !== origin) return { error: "return_url must be on the calling site" }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return { error: "return_url must be https" }
  }
  const tagged = (state: string) => {
    const u = new URL(url)
    u.searchParams.set("paycraft_checkout", state)
    return u.toString()
  }
  return { success: tagged("success"), cancel: tagged("cancel") }
}

export interface StripeSessionInput {
  priceId: string
  email: string
  sku: string
  tenantId: string
  productId: string
  mode: "test" | "live"
  trialDays: number
  success: string
  cancel: string
  /** A win-back offer's discount: the promotion code when synced, else the coupon (paycraft-paywall-analytics). */
  discount?: { promotionCodeId: string | null; couponId: string | null } | null
  /** Echoed on the session so the webhook can mark the offer redeemed once payment succeeds. */
  winbackOfferId?: string | null
}

/** The form body for POST https://api.stripe.com/v1/checkout/sessions (a subscription for one price). */
export function stripeSessionForm(i: StripeSessionInput): string {
  const f = new URLSearchParams()
  f.set("mode", "subscription")
  f.set("line_items[0][price]", i.priceId)
  f.set("line_items[0][quantity]", "1")
  f.set("customer_email", i.email)
  f.set("success_url", i.success)
  f.set("cancel_url", i.cancel)
  const meta: Record<string, string> = {
    plan_id: i.sku,
    paycraft_tenant_id: i.tenantId,
    paycraft_product_id: i.productId,
    paycraft_email: i.email,
    paycraft_mode: i.mode,
  }
  for (const [k, v] of Object.entries(meta)) {
    f.set(`metadata[${k}]`, v)
    // Renewals arrive as subscription events: the subscription carries the same keys.
    f.set(`subscription_data[metadata][${k}]`, v)
  }
  if (i.trialDays > 0) f.set("subscription_data[trial_period_days]", String(i.trialDays))
  if (i.discount?.promotionCodeId) f.set("discounts[0][promotion_code]", i.discount.promotionCodeId)
  else if (i.discount?.couponId) f.set("discounts[0][coupon]", i.discount.couponId)
  if (i.winbackOfferId) {
    f.set("metadata[paycraft_winback_offer]", i.winbackOfferId)
    f.set("subscription_data[metadata][paycraft_winback_offer]", i.winbackOfferId)
  }
  return f.toString()
}
