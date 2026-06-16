import { createClient as createServiceClient } from "@supabase/supabase-js"
import { buildUpiLink, generateUpiReference, paiseToRupees } from "@/lib/upi"
import { recordUpiIntent } from "@/lib/upi-intent-recorder"
import type { ProductForRouting } from "@/lib/checkout-router"

/**
 * Multi-option checkout resolver — companion to `routeCheckout()` but
 * returns the FULL list of eligible methods instead of just the cheapest.
 *
 * Use when the merchant wants customers to choose explicitly (e.g. "Pay
 * with UPI" vs "Pay with card"). The SDK calls this, renders a picker,
 * the customer taps one method, the SDK opens that URL.
 *
 * The first item in the returned array is the recommended pick (lowest
 * fee % among eligible methods); the rest are sorted by fee ascending so
 * customers see "best deal" at the top.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export interface CheckoutOption {
  method: string
  display_name: string
  provider: string
  url: string
  estimated_fee_percent: number
  supports_subscription: boolean
  currency: string
  reference?: string         // UPI only
  qr_payload?: string         // UPI only — render as QR on iOS/desktop
  recommended: boolean        // true for the cheapest option only
  badge?: string              // "0% fees" / "Recommended" / "Instant" — for UI hint
  /**
   * When true, the SDK must POST /api/checkout-initiate with this method
   * + customer email instead of opening `url` directly. `url` here is a
   * placeholder (typically the cached one-time URL) — useful as a
   * fallback preview but not for actual checkout. Subscription methods on
   * PSPs (razorpay_*, cashfree_*) set this because each customer's UPI
   * Autopay mandate is a per-customer artifact.
   */
  requires_initiate: boolean
}

interface RegistryRow {
  method: string
  display_name: string
  provider: string
  supports_one_time: boolean
  supports_subscription: boolean
  supported_countries: string[]
  supported_currencies: string[]
  fee_percent: number
  fee_fixed_cents: number
  cross_border_markup_percent: number
}

interface ProviderRow {
  provider: string
  test_key_id: string | null
  live_key_id: string | null
  test_payment_links: Record<string, string> | null
  live_payment_links: Record<string, string> | null
}

export async function listCheckoutOptions({
  tenantId,
  product,
  customer,
}: {
  tenantId: string
  product: ProductForRouting
  customer?: {
    country?: string | null
    currency?: string | null
  }
}): Promise<CheckoutOption[]> {
  const admin = createServiceClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const customerCurrency = (
    customer?.currency ?? product.base_currency
  ).toUpperCase()
  const customerCountry = customer?.country?.toUpperCase() ?? null

  const [
    { data: registryRows },
    { data: methodRows },
    { data: providerRows },
  ] = await Promise.all([
    admin.from("provider_method_registry").select("*"),
    admin
      .from("tenant_payment_methods")
      .select("method, enabled, config")
      .eq("tenant_id", tenantId),
  admin
      .from("tenant_providers")
      .select(
        "provider, test_key_id, live_key_id, test_payment_links, live_payment_links",
      )
      .eq("tenant_id", tenantId),
  ])

  const tenantMethods = new Map<string, { enabled: boolean; config: any }>(
    (methodRows ?? []).map((r: any) => [r.method, r]),
  )
  const providers = new Map<string, ProviderRow>(
    (providerRows ?? []).map((r: any) => [r.provider, r]),
  )

  const productIsRecurring = product.type === "subscription"
  const out: CheckoutOption[] = []

  // Iterate the registry — every method gets considered, only the
  // eligible ones land in the result.
  for (const row of (registryRows ?? []) as RegistryRow[]) {
    if (productIsRecurring && !row.supports_subscription) continue
    if (!productIsRecurring && !row.supports_one_time) continue

    if (
      row.supported_countries.length > 0 &&
      customerCountry &&
      !row.supported_countries.includes(customerCountry)
    ) {
      continue
    }
    if (
      row.supported_currencies.length > 0 &&
      !row.supported_currencies.includes(customerCurrency)
    ) {
      continue
    }

    const candidate = generateOption(
      row,
      tenantMethods,
      providers,
      tenantId,
      product,
      customerCurrency,
    )
    if (candidate) out.push(candidate)
  }

  // Cheapest first; mark the first one as recommended.
  out.sort((a, b) => a.estimated_fee_percent - b.estimated_fee_percent)
  if (out.length > 0) {
    out[0].recommended = true
    if (out[0].estimated_fee_percent === 0) {
      out[0].badge = "0% fees"
    } else {
      out[0].badge = "Recommended"
    }
    // UPI Direct always gets the "Instant" badge regardless of position.
    for (const o of out) {
      if (o.method === "direct_upi" && o.badge === undefined) o.badge = "Instant"
    }
  }
  return out
}

function generateOption(
  row: RegistryRow,
  tenantMethods: Map<string, { enabled: boolean; config: any }>,
  providers: Map<string, ProviderRow>,
  tenantId: string,
  product: ProductForRouting,
  customerCurrency: string,
): CheckoutOption | null {
  switch (row.method) {
    case "direct_upi":
      return tryDirectUpi(row, tenantMethods, tenantId, product, customerCurrency)
    case "stripe_card":
      return tryStripeCard(row, providers, product, customerCurrency)
    case "razorpay":
      return tryRazorpay(row, providers, product, customerCurrency)
    case "cashfree_upi":
      return tryCashfree(row, providers, product, customerCurrency)
    default:
      return null // not implemented yet
  }
}

function tryCashfree(
  row: RegistryRow,
  providers: Map<string, ProviderRow>,
  product: ProductForRouting,
  customerCurrency: string,
): CheckoutOption | null {
  if (customerCurrency !== "INR") return null
  const cashfree = providers.get("cashfree")
  if (!cashfree) return null
  const liveAvailable = !!cashfree.live_key_id
  const testAvailable = !!cashfree.test_key_id
  if (!liveAvailable && !testAvailable) return null

  const linksMap = liveAvailable
    ? cashfree.live_payment_links
    : cashfree.test_payment_links
  if (!linksMap) return null
  // Find a link for this product (search by metadata link_notes that
  // contains paycraft_product_id matching).  We stored them keyed by
  // currency at the moment for compatibility with Stripe/Razorpay shape;
  // a future migration may move to per-product keying for multi-product
  // disambiguation.
  const url = linksMap[customerCurrency] ?? linksMap["INR"]
  if (!url) return null

  return {
    method: "cashfree_upi",
    display_name: row.display_name,
    provider: "cashfree",
    url,
    estimated_fee_percent: row.fee_percent,
    supports_subscription: row.supports_subscription,
    currency: "INR",
    recommended: false,
    // Cashfree one-time link works without initiate; we still flag it
    // so the SDK has a uniform pattern (always POST initiate before open).
    requires_initiate: true,
  }
}

function tryDirectUpi(
  row: RegistryRow,
  tenantMethods: Map<string, { enabled: boolean; config: any }>,
  tenantId: string,
  product: ProductForRouting,
  customerCurrency: string,
): CheckoutOption | null {
  if (customerCurrency !== "INR") return null
  const method = tenantMethods.get("direct_upi")
  if (!method?.enabled) return null
  const config = method.config ?? {}
  if (!config.vpa || !config.display_name) return null

  const amountRupees = paiseToRupees(product.base_price_cents)
  const reference = generateUpiReference(tenantId, product.id)
  const url = buildUpiLink(
    {
      vpa: config.vpa,
      display_name: config.display_name,
      merchant_code: config.merchant_code,
    },
    {
      amount_rupees: amountRupees,
      reference,
      note: product.display_name.slice(0, 80),
    },
  )

  // Fire-and-forget: record this intent in the reconciliation ledger so the
  // merchant can match it against bank notifications. Never blocks the URL
  // generation — checkout responsiveness wins over ledger completeness.
  void recordUpiIntent({
    tenantId,
    productId: product.id,
    reference,
    vpa: config.vpa,
    vpaDisplayName: config.display_name,
    amountPaise: product.base_price_cents,
  })

  return {
    method: "direct_upi",
    display_name: row.display_name,
    provider: "direct_upi",
    url,
    estimated_fee_percent: 0,
    supports_subscription: false,
    currency: "INR",
    reference,
    qr_payload: url,
    recommended: false,
    // Direct UPI doesn't strictly require initiate (the URL is fully formed)
    // but going through initiate lets us record customer_email on the
    // intent so reconciliation auto-fills the right customer.
    requires_initiate: true,
  }
}

function tryStripeCard(
  row: RegistryRow,
  providers: Map<string, ProviderRow>,
  product: ProductForRouting,
  customerCurrency: string,
): CheckoutOption | null {
  const stripe = providers.get("stripe")
  if (!stripe) return null
  const liveAvailable = !!stripe.live_key_id
  const testAvailable = !!stripe.test_key_id
  if (!liveAvailable && !testAvailable) return null
  const linksMap = liveAvailable
    ? stripe.live_payment_links
    : stripe.test_payment_links
  if (!linksMap) return null
  const url = linksMap[customerCurrency] ?? linksMap[customerCurrency.toLowerCase()]
  if (!url) return null

  const isCrossBorder = customerCurrency !== product.base_currency
  const feePct = row.fee_percent + (isCrossBorder ? row.cross_border_markup_percent : 0)
  return {
    method: "stripe_card",
    display_name: row.display_name,
    provider: "stripe",
    url,
    estimated_fee_percent: feePct,
    supports_subscription: row.supports_subscription,
    currency: customerCurrency,
    recommended: false,
    // Stripe Payment Links accept ?prefilled_email — the initiate endpoint
    // appends it. Functional without initiate, but the email-prefill UX
    // is nicer with.
    requires_initiate: true,
  }
}

function tryRazorpay(
  row: RegistryRow,
  providers: Map<string, ProviderRow>,
  product: ProductForRouting,
  customerCurrency: string,
): CheckoutOption | null {
  if (customerCurrency !== "INR") return null
  const razorpay = providers.get("razorpay")
  if (!razorpay) return null
  const liveAvailable = !!razorpay.live_key_id
  const testAvailable = !!razorpay.test_key_id
  if (!liveAvailable && !testAvailable) return null
  const linksMap = liveAvailable
    ? razorpay.live_payment_links
    : razorpay.test_payment_links
  if (!linksMap) return null
  const url = linksMap[customerCurrency] ?? linksMap["INR"]
  if (!url) return null

  return {
    method: "razorpay",
    display_name: row.display_name,
    provider: "razorpay",
    url,
    estimated_fee_percent: row.fee_percent,
    supports_subscription: row.supports_subscription,
    currency: "INR",
    recommended: false,
    // Razorpay subscriptions REQUIRE initiate (per-customer subscription
    // creation via API). One-time also benefits from initiate (audit log)
    // but the cached URL works without.
    requires_initiate: true,
  }
}
