// supabase/functions/attempt-stitch/match.ts
//
// How attempt-stitch recognises an attempt an OLD writer recorded without the SDK's attempt id (D1): each
// rule names the provider key that identifies the attempt, and that name is stored as `match_rule` beside
// `correlation = inferred`, so nobody ever mistakes an inferred attempt for an exact one.
//
//   stripe       cs_* (Checkout Session, 186's expired / async-failed webhooks) · pi_* (PaymentIntent)
//   razorpay     sub_* (Subscription) · pay_* (payment.failed) · plink_* (expired / cancelled link)
//   cashfree     the order id (PAYMENT_FAILED / USER_DROPPED)
//   google_play  the SDK's own `<millis>-<hex>` attempt id (188 keys store reports on it) · else a purchase token
//   app_store    the SDK's own attempt id · else Apple's numeric original_transaction_id
//
// Pure: no I/O, so every rule is unit-tested on its own.

export interface LegacyRow {
  provider: string
  provider_session_id: string
}

export interface MatchResult {
  match_rule: string
}

/** The id PayCraftBillingManager mints for a store attempt: `<epoch millis>-<random hex>`. */
const SDK_STORE_ATTEMPT_ID = /^\d{10,}-[0-9a-f]+$/

export function matchStripeLegacy(r: LegacyRow): MatchResult | null {
  if (r.provider_session_id.startsWith("cs_")) return { match_rule: "stripe_session_id" }
  if (r.provider_session_id.startsWith("pi_")) return { match_rule: "stripe_payment_intent" }
  return null
}

export function matchRazorpayLegacy(r: LegacyRow): MatchResult | null {
  if (r.provider_session_id.startsWith("sub_")) return { match_rule: "razorpay_subscription_id" }
  if (r.provider_session_id.startsWith("pay_")) return { match_rule: "razorpay_payment_id" }
  if (r.provider_session_id.startsWith("plink_")) return { match_rule: "razorpay_payment_link_id" }
  return null
}

export function matchCashfreeLegacy(r: LegacyRow): MatchResult | null {
  return r.provider_session_id.trim() ? { match_rule: "cashfree_order_id" } : null
}

export function matchPlayLegacy(r: LegacyRow): MatchResult | null {
  if (SDK_STORE_ATTEMPT_ID.test(r.provider_session_id)) return { match_rule: "sdk_store_attempt_id" }
  return r.provider_session_id.trim() ? { match_rule: "play_purchase_token" } : null
}

export function matchAppStoreLegacy(r: LegacyRow): MatchResult | null {
  if (SDK_STORE_ATTEMPT_ID.test(r.provider_session_id)) return { match_rule: "sdk_store_attempt_id" }
  if (/^\d+$/.test(r.provider_session_id)) return { match_rule: "appstore_original_transaction_id" }
  return null
}

/** The rule for a row of any provider, or null when no rule identifies it. */
export function stitchMatch(r: LegacyRow): MatchResult | null {
  switch (r.provider) {
    case "stripe":
      return matchStripeLegacy(r)
    case "razorpay":
      return matchRazorpayLegacy(r)
    case "cashfree":
      return matchCashfreeLegacy(r)
    case "google_play":
      return matchPlayLegacy(r)
    case "app_store":
      return matchAppStoreLegacy(r)
    default:
      return null
  }
}

/**
 * The attempt id an inferred row gets: `inf-<provider>-<32 hex of sha256(provider:key)>` — deterministic (a
 * re-run assigns the same id), bounded in length whatever the provider key is, and impossible to confuse
 * with an id the SDK minted.
 */
export async function inferredAttemptId(provider: string, providerSessionId: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${provider}:${providerSessionId}`))
  const hex = [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
  return `inf-${provider}-${hex.slice(0, 32)}`
}
