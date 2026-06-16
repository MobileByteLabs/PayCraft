import { createClient as createServiceClient } from "@supabase/supabase-js"
import { buildUpiLink, generateUpiReference, paiseToRupees } from "@/lib/upi"
import { recordUpiIntent } from "@/lib/upi-intent-recorder"

/**
 * Checkout router — given a (tenant, product, customer context) tuple,
 * return the cheapest eligible payment method's checkout URL.
 *
 * Inputs:
 *   - tenantId      The PayCraft tenant
 *   - product       Product record (must include type, base_price_cents,
 *                   currency, stripe_price_id_by_currency, etc.)
 *   - customer      Optional context: country (ISO 3166-1 alpha-2),
 *                   currency (ISO 4217), email
 *
 * Decision flow:
 *   1. Load tenant_routing_rules ordered by priority. For each rule that
 *      matches the customer's (country, currency, product_type) tuple
 *      (NULL fields are wildcards), iterate priority_methods.
 *   2. For each candidate method, check:
 *        - Is it enabled for this tenant?
 *          • direct_upi  → tenant_payment_methods row, enabled=true
 *          • stripe_*    → tenant_providers row with stripe + matching key
 *          • razorpay_*  → tenant_providers row with razorpay + matching key
 *        - Does it support the product type?
 *        - Does it support the customer currency?
 *      First method that passes all three wins.
 *   3. If no rule matches OR no candidate in any rule is eligible, fall
 *      back to whatever method has the lowest fee_percent in the registry
 *      that's enabled (last-resort safety net so the SDK never gets
 *      stranded with "no checkout url").
 *
 * The router NEVER calls a third-party API directly — it generates URLs
 * from data already in the DB (Stripe Payment Link URLs were created at
 * sync time and stored in tenant_providers; UPI URLs are built from VPA +
 * amount on the fly). That keeps p99 fast and lets the SDK cache results
 * for 1h at a time.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export interface CheckoutRouteRequest {
  tenantId: string
  product: ProductForRouting
  customer?: {
    country?: string | null  // ISO 3166-1 alpha-2
    currency?: string | null // ISO 4217
    email?: string | null
  }
}

export interface ProductForRouting {
  id: string
  type: "subscription" | "trial" | "lifetime"
  display_name: string
  base_price_cents: number
  base_currency: string
  interval: string | null
  stripe_price_id_by_currency: Record<string, string> | null
  // Payment link URLs the dashboard cached at sync time. May be stale;
  // the router treats absence as "Stripe unavailable for this currency".
  stripe_payment_links_by_currency?: Record<string, string> | null
  razorpay_plan_id_by_currency?: Record<string, string> | null
  razorpay_payment_links_by_currency?: Record<string, string> | null
}

export interface CheckoutRoute {
  url: string
  method: string                     // e.g. "direct_upi", "stripe_card"
  provider: string                   // e.g. "direct_upi", "stripe"
  estimated_fee_percent: number      // 0..15 — for analytics + display
  supports_subscription: boolean
  currency: string                   // which currency the customer is charged in
  reference?: string                 // server-generated txn ref (UPI only)
  qr_payload?: string                // for direct UPI on non-Android — same URL, rendered as QR client-side
  note?: string                      // freeform message ("falling back to Stripe; no UPI vpa configured")
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

interface MethodRow {
  method: string
  enabled: boolean
  config: any
}

interface RoutingRuleRow {
  country_code: string | null
  currency: string | null
  product_type: string | null
  priority_methods: string[]
  priority: number
}

interface ProviderRow {
  provider: string
  test_key_id: string | null
  live_key_id: string | null
  test_payment_links: Record<string, string> | null
  live_payment_links: Record<string, string> | null
}

/**
 * Public entry point. Returns null if no eligible method exists — caller
 * is responsible for surfacing a "no checkout method available" error to
 * the SDK (typically means the merchant hasn't connected anything yet).
 */
export async function routeCheckout(
  req: CheckoutRouteRequest,
): Promise<CheckoutRoute | null> {
  const admin = createServiceClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Customer currency falls back to product's base_currency if not given.
  const customerCurrency = (
    req.customer?.currency ?? req.product.base_currency
  ).toUpperCase()
  const customerCountry = req.customer?.country?.toUpperCase() ?? null

  // Fetch all the data in parallel — keep this to a single round-trip per
  // pile to keep p99 low.
  const [
    { data: registryRows },
    { data: methodRows },
    { data: ruleRows },
    { data: providerRows },
  ] = await Promise.all([
    admin.from("provider_method_registry").select("*"),
    admin
      .from("tenant_payment_methods")
      .select("method, enabled, config")
      .eq("tenant_id", req.tenantId),
    admin
      .from("tenant_routing_rules")
      .select("country_code, currency, product_type, priority_methods, priority")
      .eq("tenant_id", req.tenantId)
      .order("priority", { ascending: true }),
    admin
      .from("tenant_providers")
      .select("provider, test_key_id, live_key_id, test_payment_links, live_payment_links")
      .eq("tenant_id", req.tenantId),
  ])

  const registry = new Map<string, RegistryRow>(
    (registryRows ?? []).map((r: any) => [r.method, r]),
  )
  const tenantMethods = new Map<string, MethodRow>(
    (methodRows ?? []).map((r: any) => [r.method, r]),
  )
  const providers = new Map<string, ProviderRow>(
    (providerRows ?? []).map((r: any) => [r.provider, r]),
  )

  // 1. Try every matching routing rule in priority order.
  const matchingRules = (ruleRows ?? []).filter((rule: RoutingRuleRow) => {
    if (rule.country_code && rule.country_code !== customerCountry) return false
    if (rule.currency && rule.currency !== customerCurrency) return false
    if (rule.product_type && rule.product_type !== req.product.type) return false
    return true
  })

  for (const rule of matchingRules) {
    for (const methodName of rule.priority_methods) {
      const candidate = tryMethod(
        methodName,
        registry,
        tenantMethods,
        providers,
        req,
        customerCurrency,
        customerCountry,
      )
      if (candidate) return candidate
    }
  }

  // 2. Fallback: cheapest-fee method that's eligible. Iterate the registry
  // sorted ascending by fee_percent.
  const sortedCandidates = [...registry.values()].sort(
    (a, b) => a.fee_percent - b.fee_percent,
  )
  for (const row of sortedCandidates) {
    const candidate = tryMethod(
      row.method,
      registry,
      tenantMethods,
      providers,
      req,
      customerCurrency,
      customerCountry,
    )
    if (candidate) return { ...candidate, note: "fallback — no routing rule matched" }
  }

  return null
}

/**
 * Try a single method — returns null if ineligible, a CheckoutRoute if it
 * can fulfil this request. Encapsulates all per-method enablement / URL
 * generation logic in one place.
 */
function tryMethod(
  methodName: string,
  registry: Map<string, RegistryRow>,
  tenantMethods: Map<string, MethodRow>,
  providers: Map<string, ProviderRow>,
  req: CheckoutRouteRequest,
  customerCurrency: string,
  customerCountry: string | null,
): CheckoutRoute | null {
  const row = registry.get(methodName)
  if (!row) return null

  // Capability check — method must support the product type.
  const productIsRecurring = req.product.type === "subscription"
  if (productIsRecurring && !row.supports_subscription) return null
  if (!productIsRecurring && !row.supports_one_time) return null

  // Geo / currency support: empty arrays in registry mean wildcard.
  if (
    row.supported_countries.length > 0 &&
    customerCountry &&
    !row.supported_countries.includes(customerCountry)
  ) {
    return null
  }
  if (
    row.supported_currencies.length > 0 &&
    !row.supported_currencies.includes(customerCurrency)
  ) {
    return null
  }

  // Per-method enablement + URL generation.
  switch (methodName) {
    case "direct_upi":
      return tryDirectUpi(row, tenantMethods, req, customerCurrency)
    case "stripe_card":
      return tryStripeCard(row, providers, req, customerCurrency)
    case "razorpay":
      return tryRazorpay(row, providers, req, customerCurrency)
    case "cashfree_upi":
      return tryCashfree(row, providers, req, customerCurrency)
    default:
      return null
  }
}

function tryCashfree(
  row: RegistryRow,
  providers: Map<string, ProviderRow>,
  req: CheckoutRouteRequest,
  customerCurrency: string,
): CheckoutRoute | null {
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
  const url = linksMap[customerCurrency] ?? linksMap["INR"]
  if (!url) return null

  return {
    url,
    method: "cashfree_upi",
    provider: "cashfree",
    estimated_fee_percent: row.fee_percent,
    supports_subscription: row.supports_subscription,
    currency: "INR",
  }
}

function tryDirectUpi(
  row: RegistryRow,
  tenantMethods: Map<string, MethodRow>,
  req: CheckoutRouteRequest,
  customerCurrency: string,
): CheckoutRoute | null {
  if (customerCurrency !== "INR") return null
  const method = tenantMethods.get("direct_upi")
  if (!method?.enabled) return null
  const config = method.config ?? {}
  if (!config.vpa || !config.display_name) return null

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

  // Record intent for reconciliation. Best-effort, never blocks routing.
  void recordUpiIntent({
    tenantId: req.tenantId,
    productId: req.product.id,
    reference,
    vpa: config.vpa,
    vpaDisplayName: config.display_name,
    amountPaise: req.product.base_price_cents,
    customerEmail: req.customer?.email ?? null,
  })

  return {
    url,
    method: "direct_upi",
    provider: "direct_upi",
    estimated_fee_percent: row.fee_percent,
    supports_subscription: false,
    currency: "INR",
    reference,
    qr_payload: url, // SDK renders this as QR on non-Android platforms
  }
}

function tryStripeCard(
  row: RegistryRow,
  providers: Map<string, ProviderRow>,
  req: CheckoutRouteRequest,
  customerCurrency: string,
): CheckoutRoute | null {
  const stripe = providers.get("stripe")
  if (!stripe) return null
  const liveAvailable = !!stripe.live_key_id
  const testAvailable = !!stripe.test_key_id
  if (!liveAvailable && !testAvailable) return null

  // Prefer live mode if both populated (matches the dashboard's livemode
  // resolution). When only test is available, use it (dev mode).
  const linksMap = liveAvailable
    ? stripe.live_payment_links
    : stripe.test_payment_links
  if (!linksMap) return null
  const url = linksMap[customerCurrency] ?? linksMap[customerCurrency.toLowerCase()]
  if (!url) return null

  // Fee model: domestic vs cross-border. If merchant is in CA but customer
  // is paying in INR, cross-border markup applies. We don't know the
  // merchant's settlement currency from the schema today — assume settle
  // currency = product.base_currency. Anything else triggers cross-border.
  const isCrossBorder = customerCurrency !== req.product.base_currency
  const feePct = row.fee_percent + (isCrossBorder ? row.cross_border_markup_percent : 0)

  return {
    url,
    method: "stripe_card",
    provider: "stripe",
    estimated_fee_percent: feePct,
    supports_subscription: row.supports_subscription,
    currency: customerCurrency,
  }
}

function tryRazorpay(
  row: RegistryRow,
  providers: Map<string, ProviderRow>,
  req: CheckoutRouteRequest,
  customerCurrency: string,
): CheckoutRoute | null {
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
    url,
    method: "razorpay",
    provider: "razorpay",
    estimated_fee_percent: row.fee_percent,
    supports_subscription: row.supports_subscription,
    currency: "INR",
  }
}
