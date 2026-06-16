/**
 * UPI Direct integration helpers.
 *
 * UPI (Unified Payments Interface) is India's account-to-account real-time
 * payment system. A "UPI Direct" payment bypasses every payment service
 * provider — the customer's UPI app (Google Pay, PhonePe, Paytm, BHIM, etc.)
 * opens via deep link, they confirm the transaction in-app, money lands in
 * the merchant's bank account directly. Fees:
 *
 *   P2P (person-to-person)         — 0%
 *   P2M small (under ~₹2000)       — 0%
 *   P2M large (over ~₹2000)        — 0% for most categories, 0.5% on some
 *                                    (NPCI's evolving MDR schedule)
 *
 * Compared to Stripe cross-border (7.8% on INR for a CAD merchant), this
 * saves ~7-8% on every Indian transaction.
 *
 * Trade-offs:
 *   - No automatic verification. Customer pays, you receive an SMS / bank
 *     notification, you (or our manual-verification flow) confirm.
 *   - No recurring/subscription. UPI Autopay requires NPCI-registered
 *     mandate which only PSPs (Razorpay, Cashfree, etc.) can issue.
 *     For subscriptions, route to Razorpay / Cashfree instead.
 *
 * UPI deep-link spec (NPCI):
 *   upi://pay?pa=<VPA>&pn=<NAME>&am=<AMOUNT>&cu=INR&tn=<NOTE>&tr=<TXNREF>
 *
 *   pa   = payee VPA (merchant@bank)        REQUIRED
 *   pn   = payee name (URL-encoded)         REQUIRED
 *   am   = amount in rupees (decimal)        REQUIRED
 *   cu   = currency, always "INR"           REQUIRED
 *   tn   = transaction note (purpose)
 *   tr   = transaction reference (our ID — surfaces in customer's UPI app
 *          + the merchant's bank statement so we can reconcile)
 *   mc   = merchant code (MCC, optional)
 *   mode = "02" for P2M; "00" for P2P
 *
 * Generated URLs are intentionally NOT URL-encoded at this layer; that's
 * the caller's job (Next.js Link / browser handles `upi:` correctly only
 * when the URI is well-formed).
 */

const VPA_REGEX = /^[a-zA-Z0-9._-]+@[a-zA-Z]+$/

export interface UpiConfig {
  vpa: string                       // merchant@bank
  display_name: string              // shown in customer's UPI app
  merchant_code?: string            // MCC (4 digits), optional
  verification_mode?: "manual" | "polling" | "psp_webhook"
}

export interface UpiLinkParams {
  amount_rupees: number             // amount in whole rupees + decimals
  reference: string                 // unique txn reference for reconciliation
  note: string                      // shown in customer's UPI app + bank stmt
}

/**
 * Validate a VPA per the NPCI spec — letters/digits/dot/underscore/hyphen
 * before @, letters after. Rejects empty strings and obvious typos. Doesn't
 * verify the VPA actually resolves; that requires a live UPI handle check
 * via a PSP, which defeats the "zero PSP" goal.
 */
export function isValidVpa(vpa: string): boolean {
  if (!vpa) return false
  if (vpa.length < 5 || vpa.length > 100) return false
  return VPA_REGEX.test(vpa)
}

/**
 * Build a `upi://pay?...` deep link conforming to NPCI's spec. The caller
 * is responsible for opening this URL on a device with a UPI app installed
 * (the OS handles the rest via the registered URL handler).
 *
 * On desktop browsers `upi:` does nothing useful — the SDK should fall
 * back to rendering a QR code of this same URL, which mobile UPI apps
 * scan natively.
 */
export function buildUpiLink(config: UpiConfig, params: UpiLinkParams): string {
  if (!isValidVpa(config.vpa)) {
    throw new Error(`invalid VPA: ${config.vpa}`)
  }
  if (params.amount_rupees <= 0) {
    throw new Error(`invalid amount: ${params.amount_rupees}`)
  }
  if (!params.reference || params.reference.length > 35) {
    throw new Error("reference must be 1-35 chars (UPI tr field limit)")
  }
  const u = new URL("upi://pay")
  // URLSearchParams handles encoding correctly — we trust it for all
  // user-controlled fields (display_name, note) which may contain spaces.
  u.searchParams.set("pa", config.vpa)
  u.searchParams.set("pn", config.display_name)
  u.searchParams.set("am", params.amount_rupees.toFixed(2))
  u.searchParams.set("cu", "INR")
  u.searchParams.set("tn", params.note.slice(0, 80)) // UPI tn field limit
  u.searchParams.set("tr", params.reference)
  if (config.merchant_code) {
    u.searchParams.set("mc", config.merchant_code)
    u.searchParams.set("mode", "02") // P2M when MCC present
  }
  // URL serializer encodes `:` in `upi:` which mobile parsers don't expect —
  // restore the unencoded scheme.
  return u.toString().replace(/^upi%3A\/\//, "upi://")
}

/**
 * Generate a unique transaction reference for a UPI flow. Format:
 *   "PC<short_tenant>-<short_product>-<unix_ms>"
 * fits within UPI's 35-char `tr` field limit.
 */
export function generateUpiReference(tenantId: string, productId: string): string {
  const shortTenant = tenantId.slice(0, 6)
  const shortProduct = productId.slice(0, 6)
  const ts = Date.now().toString(36).toUpperCase()
  return `PC${shortTenant}-${shortProduct}-${ts}`
}

/**
 * Convert paise (or any currency's minor units) to whole-rupee decimal —
 * UPI amounts are formatted as decimal rupees, NOT minor units like Stripe.
 * For INR the conversion is /100; we keep this typed in case PayCraft ever
 * extends UPI to zero-decimal-like behavior, but realistically UPI = INR.
 */
export function paiseToRupees(paise: number): number {
  return Math.round(paise) / 100
}
