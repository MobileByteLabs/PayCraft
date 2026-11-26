// supabase/functions/checkout-initiate/razorpay-subscription.ts
//
// The Razorpay lane of checkout-initiate, kept free of I/O so it is testable on its own: the body for
// POST https://api.razorpay.com/v1/subscriptions.
//
// RECONCILIATION IS ALREADY WIRED. The subscription is created with the notes the shipped razorpay-webhook
// reads — `paycraft_email`, `paycraft_plan`, `paycraft_mode`, `paycraft_tenant_id`, `paycraft_product_id` —
// so `subscription.authenticated` / `.charged` flow into the existing entitlement handler with no further
// work. `attempt_id` (migration 210) is the SDK's purchase-attempt id: Razorpay echoes it on every webhook,
// which is how the webhook closes the same attempt record checkout-initiate opened.

/**
 * Charges to authorise, chosen to be ~10 years while staying inside Razorpay's per-period maximum.
 * Yearly is the one that bites: its cap is 100, not the 120 a monthly plan allows.
 */
export function totalCountFor(interval: string): number {
  switch (interval) {
    case "year":
      return 100
    case "semiannual":
      return 20
    case "quarter":
      return 40
    default:
      return 120
  }
}

export interface RazorpaySubscriptionInput {
  planId: string
  interval: string
  email: string
  phone: string | null | undefined
  name: string | null | undefined
  tenantId: string
  productId: string
  sku: string
  mode: "test" | "live"
  /** The trial /config advertises (_shared/trial.ts); 0 = none. */
  trialDays: number
  /** Unix seconds "now" — the trial is expressed as the gap to start_at. */
  nowSeconds: number
  /** The SDK's purchase-attempt id, or null for an older SDK. */
  attemptId?: string | null
  /** A claimed win-back offer's Razorpay offer, and the offer row it came from. */
  winback?: { razorpayOfferId: string; offerId: string } | null
}

export function razorpaySubscriptionPayload(i: RazorpaySubscriptionInput): Record<string, unknown> {
  const notes: Record<string, string> = {
    paycraft_tenant_id: i.tenantId,
    paycraft_product_id: i.productId,
    paycraft_plan: i.sku,
    paycraft_email: i.email,
    paycraft_mode: i.mode,
    // Omitted rather than sent blank. An empty string is a value Razorpay stores and echoes back on every
    // webhook, so downstream code cannot tell "no name given" from "name is empty".
    ...(i.name ? { paycraft_customer_name: i.name } : {}),
    ...(i.attemptId ? { attempt_id: i.attemptId } : {}),
  }
  const payload: Record<string, unknown> = {
    plan_id: i.planId,
    // Razorpay caps total_count PER PERIOD, and the cap is not the same for all of them — a yearly plan
    // rejects anything above 100 with "Exceeds the maximum total_count (100) allowed for the given period
    // and interval". A single hardcoded 120 made every ANNUAL subscription impossible to create. Aim for
    // ~10 years within each cap; the subscription auto-completes after this many charges, so too small a
    // number would quietly end a subscription the buyer believes is ongoing.
    total_count: totalCountFor(i.interval),
    customer_notify: 1,
    notify_info: {
      notify_email: i.email,
      ...(i.phone ? { notify_phone: i.phone } : {}),
    },
    // Echoed back on every webhook — this is how razorpay-webhook routes the event to a tenant, a
    // subscriber and an attempt without a separate lookup table.
    notes,
  }
  // Razorpay's start_at is the FIRST CHARGE time, so a trial is the gap between now and start_at.
  if (i.trialDays > 0) payload.start_at = i.nowSeconds + i.trialDays * 86_400
  if (i.winback) {
    payload.offer_id = i.winback.razorpayOfferId
    notes.paycraft_winback_offer = i.winback.offerId
  }
  return payload
}
