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

function initiateStripeCard(
  providers: Map<string, ProviderRow>,
  req: InitiateCheckoutRequest,
  currency: string,
): InitiateCheckoutResult {
  const stripe = providers.get("stripe")
  if (!stripe) throw new Error("Stripe not configured")
  const liveAvailable = !!stripe.live_key_id
  const linksMap = liveAvailable
    ? stripe.live_payment_links
    : stripe.test_payment_links
  if (!linksMap) throw new Error("no Stripe payment links cached")
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
  const liveAvailable = !!razorpay.live_key_id
  const mode: "test" | "live" = liveAvailable ? "live" : "test"

  // Subscription products → create per-customer Razorpay Subscription with
  // UPI Autopay. We use the plan_id from tenant_products.
  if (req.product.type === "subscription") {
    const planId = req.product.razorpay_plan_id_by_currency?.["INR"]
    if (!planId) {
      throw new Error(
        "Razorpay plan not yet synced for this product in INR — re-sync at /products",
      )
    }
    const sub = await createUpiAutopaySubscription({
      tenantId: req.tenantId,
      planId,
      customerEmail: req.customer.email,
      customerName: req.customer.name,
      customerPhone: req.customer.phone,
      productSku: req.product.display_name,
      productId: req.product.id,
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
  const linksMap = liveAvailable
    ? razorpay.live_payment_links
    : razorpay.test_payment_links
  if (!linksMap) throw new Error("no Razorpay payment links cached")
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
  const liveAvailable = !!cashfree.live_key_id
  const linksMap = liveAvailable
    ? cashfree.live_payment_links
    : cashfree.test_payment_links
  if (!linksMap) throw new Error("no Cashfree payment links cached")
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
