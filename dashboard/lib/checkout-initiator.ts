import { createClient as createServiceClient } from "@supabase/supabase-js"
import { buildUpiLink, generateUpiReference, paiseToRupees } from "@/lib/upi"
import { recordUpiIntent } from "@/lib/upi-intent-recorder"
import { createUpiAutopaySubscription } from "@/lib/razorpay-subscription-initiator"
import type { ProductForRouting } from "@/lib/checkout-router"

/**
 * Per-customer checkout INITIATION.
 *
 * `checkout-options` is the BROWSE endpoint (lists methods, no per-customer
 * side effects). This is the GO endpoint — invoked after the customer
 * picks a method and supplies their email. Returns the actual URL to open.
 *
 * Why split: subscription methods need a per-customer artifact:
 *   - Razorpay subscription → must create a Razorpay Subscription bound
 *     to the customer's email to issue UPI Autopay mandate.
 *   - Cashfree subscription → same (when implemented).
 *   - Stripe subscription → Payment Link is reusable but we may also want
 *     to prefill the email on the redirect URL.
 *   - UPI Direct → records an intent with the customer's email so the
 *     dashboard reconciliation page auto-suggests the right customer.
 *   - One-time methods → the static link (already cached at sync time) is
 *     fine, but routing through this endpoint lets us record an audit-log
 *     entry + standardise the shape the SDK consumes.
 *
 * This way the SDK pattern is: GET checkout-options → user picks one → POST
 * checkout-initiate with {method, customer_email} → open the returned URL.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export interface InitiateCheckoutRequest {
  tenantId: string
  product: ProductForRouting
  method: string  // "direct_upi" | "stripe_card" | "razorpay" | "cashfree_upi"
  /**
   * Which credential mode to transact in. EXPLICIT, and it defaults to "test".
   *
   * This used to be derived as `!!live_key_id ? "live" : "test"` at each provider, which is not a
   * choice at all: once a live key exists that expression is always "live", so there was no way to
   * run a test checkout from the dashboard — the operator's only options were "charge a real card"
   * or "don't test". The SDK path never had this problem; `/config` and the `checkout-initiate`
   * edge function both read the CALLER's key (`apiKey.startsWith("pk_test_")`), and this is the
   * dashboard catching up to that contract.
   *
   * Defaulting to "test" is deliberate: the failure mode of guessing wrong toward test is a
   * checkout that doesn't charge, and toward live is one that does.
   */
  mode?: "test" | "live"
  customer: {
    email: string                // required for subscription mandates
    name?: string | null
    phone?: string | null
    country?: string | null
    currency?: string | null
  }
}

export interface InitiateCheckoutResult {
  url: string
  method: string
  provider: string
  currency: string
  reference?: string             // UPI only
  qr_payload?: string             // UPI only
  subscription_id?: string        // razorpay subscription id (for downstream tracking)
  // Optional human-readable hint surfaced to the SDK / dashboard preview.
  note?: string
}

interface ProviderRow {
  provider: string
  test_key_id: string | null
  live_key_id: string | null
  test_payment_links: Record<string, string> | null
  live_payment_links: Record<string, string> | null
}

interface TenantPaymentMethodRow {
  method: string
  enabled: boolean
  config: any
}

export async function initiateCheckout(
  req: InitiateCheckoutRequest,
): Promise<InitiateCheckoutResult> {
  const admin = createServiceClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const currency = (
    req.customer.currency ?? req.product.base_currency
  ).toUpperCase()

  // Single round-trip — pull everything we might need.
  const [
    { data: methodRows },
    { data: providerRows },
  ] = await Promise.all([
    admin
      .from("tenant_payment_methods")
      .select("method, enabled, config")
      .eq("tenant_id", req.tenantId),
    admin
      .from("tenant_providers")
      .select(
        "provider, test_key_id, live_key_id, test_payment_links, live_payment_links",
      )
      .eq("tenant_id", req.tenantId),
  ])
  const tenantMethods = new Map<string, TenantPaymentMethodRow>(
    (methodRows ?? []).map((r: any) => [r.method, r]),
  )
  const providers = new Map<string, ProviderRow>(
    (providerRows ?? []).map((r: any) => [r.provider, r]),
  )

  switch (req.method) {
    case "direct_upi":
      return initiateDirectUpi(tenantMethods, req, currency)
    case "stripe_card":
      return initiateStripeCard(providers, req, currency)
    case "razorpay":
      return initiateRazorpay(providers, req, currency)
    case "cashfree_upi":
      return initiateCashfree(providers, req, currency)
    default:
      throw new Error(`unknown checkout method: ${req.method}`)
  }
}

function initiateDirectUpi(
  tenantMethods: Map<string, TenantPaymentMethodRow>,
  req: InitiateCheckoutRequest,
  currency: string,
): InitiateCheckoutResult {
  if (currency !== "INR") {
    throw new Error("direct_upi only supports INR")
  }
  if (req.product.type === "subscription") {
    throw new Error(
      "direct_upi cannot fulfil subscriptions — pick a PSP method (razorpay / cashfree_upi) instead",
    )
  }
  const method = tenantMethods.get("direct_upi")
  if (!method?.enabled) throw new Error("direct_upi not configured for this tenant")
  const config = method.config ?? {}
  if (!config.vpa || !config.display_name) {
    throw new Error("direct_upi config missing vpa or display_name")
  }
  const amountRupees = paiseToRupees(req.product.base_price_cents)
  const reference = generateUpiReference(req.tenantId, req.product.id)
  const url = buildUpiLink(
    {
      vpa: config.vpa,
      display_name: config.display_name,
      merchant_code: config.merchant_code,
    },
    {
      amount_rupees: amountRupees,
      reference,
      note: req.product.display_name.slice(0, 80),
    },
  )

  // Record intent with the customer email so the dashboard reconciliation
  // page can auto-populate the "Customer email" field on mark-paid.
  void recordUpiIntent({
    tenantId: req.tenantId,
    productId: req.product.id,
    reference,
    vpa: config.vpa,
    vpaDisplayName: config.display_name,
    amountPaise: req.product.base_price_cents,
    customerEmail: req.customer.email,
    customerName: req.customer.name ?? null,
  })

  return {
    url,
    method: "direct_upi",
    provider: "direct_upi",
    currency: "INR",
    reference,
    qr_payload: url,
  }
}

/**
 * Resolve the link map for the REQUESTED mode, and fail loudly when it is empty.
 *
 * The old `liveAvailable ? live : test` silently substituted live links whenever a live key
 * existed. Substituting the other mode is never safe here: "test" silently becoming "live" charges
 * a real card, and "live" silently becoming "test" takes a payment that never settles. An error
 * the operator can read beats either.
 */
function linksForMode(
  provider: string,
  row: { test_payment_links: Record<string, string> | null; live_payment_links: Record<string, string> | null; test_key_id: string | null; live_key_id: string | null },
  mode: "test" | "live",
): Record<string, string> {
  const map = mode === "live" ? row.live_payment_links : row.test_payment_links
  if (map && Object.keys(map).length > 0) return map

  const hasKey = mode === "live" ? !!row.live_key_id : !!row.test_key_id
  throw new Error(
    hasKey
      ? `${provider} has a ${mode} key but no ${mode} payment links — run product sync ` +
        `(POST /api/sync/all); runProductSync writes every configured mode`
      : `${provider} has no ${mode}-mode credential, so no ${mode} payment links exist. ` +
        `Add a ${mode} key in Providers → ${provider} and sync. ` +
        (mode === "test"
          ? `Refusing to fall back to LIVE links — that would charge a real card for a test checkout.`
          : `Refusing to fall back to TEST links — that payment would never settle.`),
  )
}

function initiateStripeCard(
  providers: Map<string, ProviderRow>,
  req: InitiateCheckoutRequest,
  currency: string,
): InitiateCheckoutResult {
  const stripe = providers.get("stripe")
  if (!stripe) throw new Error("Stripe not configured")
  const linksMap = linksForMode("stripe", stripe, req.mode ?? "test")
  const url = linksMap[currency] ?? linksMap[currency.toLowerCase()]
  if (!url) throw new Error(`no Stripe payment link for currency ${currency}`)

  // Stripe Payment Links accept `prefilled_email` as a query param for the
  // hosted checkout page — saves the customer typing it.
  const finalUrl = appendQueryParam(url, "prefilled_email", req.customer.email)
  return {
    url: finalUrl,
    method: "stripe_card",
    provider: "stripe",
    currency,
  }
}

async function initiateRazorpay(
  providers: Map<string, ProviderRow>,
  req: InitiateCheckoutRequest,
  currency: string,
): Promise<InitiateCheckoutResult> {
  if (currency !== "INR") {
    throw new Error("razorpay methods only support INR")
  }
  const razorpay = providers.get("razorpay")
  if (!razorpay) throw new Error("Razorpay not configured")
  // Requested mode, not "whatever key happens to exist" — see InitiateCheckoutRequest.mode.
  // Razorpay's subscription path below ALSO keys off this, so a test checkout creates a test
  // subscription rather than a real mandate against the customer's bank.
  const mode: "test" | "live" = req.mode ?? "test"

  // Subscription products → create per-customer Razorpay Subscription with
  // UPI Autopay. We use the plan_id from tenant_products.
  if (req.product.type === "subscription") {
    // MODE-SCOPED since 141. Reading the live column in test mode (or vice versa) hands Razorpay a
    // plan from the other account, which it rejects — and the failure reads as a payment problem
    // rather than the data problem it is. There is no fallback to the other mode on purpose: a
    // missing test plan must say so, not quietly bill against a live one.
    const planMap =
      mode === "test"
        ? req.product.razorpay_plan_id_by_currency_test
        : req.product.razorpay_plan_id_by_currency
    const planId = planMap?.["INR"]
    if (!planId) {
      throw new Error(
        `Razorpay ${mode} plan not yet synced for this product in INR — re-sync at /products`,
      )
    }
    // Free trial → Razorpay start_at (first charge delayed by the trial window).
    const trialDurationDays =
      req.product.trial_enabled && req.product.trial_duration_days
        ? Number(req.product.trial_duration_days)
        : undefined
    const sub = await createUpiAutopaySubscription({
      tenantId: req.tenantId,
      planId,
      customerEmail: req.customer.email,
      customerName: req.customer.name,
      customerPhone: req.customer.phone,
      productSku: req.product.display_name,
      productId: req.product.id,
      trialDurationDays,
      mode,
    })
    return {
      url: sub.shortUrl,
      method: "razorpay",
      provider: "razorpay",
      currency: "INR",
      subscription_id: sub.subscriptionId,
      note: "Customer authorizes UPI Autopay mandate; subscription.authenticated webhook flips PayCraft to active.",
    }
  }

  // One-time products → use the cached Payment Link.
  const linksMap = linksForMode("razorpay", razorpay, mode)
  const url = linksMap[currency] ?? linksMap["INR"]
  if (!url) throw new Error(`no Razorpay payment link for ${currency}`)
  return {
    url,
    method: "razorpay",
    provider: "razorpay",
    currency: "INR",
  }
}

function initiateCashfree(
  providers: Map<string, ProviderRow>,
  req: InitiateCheckoutRequest,
  currency: string,
): InitiateCheckoutResult {
  if (currency !== "INR") {
    throw new Error("cashfree methods only support INR")
  }
  if (req.product.type === "subscription") {
    throw new Error(
      "Cashfree UPI Autopay (subscriptions) not yet implemented — pick razorpay for INR subscriptions",
    )
  }
  const cashfree = providers.get("cashfree")
  if (!cashfree) throw new Error("Cashfree not configured")
  const linksMap = linksForMode("cashfree", cashfree, req.mode ?? "test")
  const url = linksMap[currency] ?? linksMap["INR"]
  if (!url) throw new Error(`no Cashfree payment link for ${currency}`)
  return {
    url,
    method: "cashfree_upi",
    provider: "cashfree",
    currency: "INR",
  }
}

function appendQueryParam(url: string, key: string, value: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set(key, value)
    return u.toString()
  } catch {
    // Some Payment Links use opaque short-link domains that may resolve
    // weirdly with URL parsing; fall back to manual append.
    const sep = url.includes("?") ? "&" : "?"
    return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
  }
}
