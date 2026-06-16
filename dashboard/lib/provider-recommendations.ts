/**
 * Provider recommendations per merchant country.
 *
 * Drives the /providers dashboard's 3-tier layout:
 *   PRIMARY        — surfaced top, "recommended for {country}"
 *   SECONDARY      — surfaced below primary, "alternates"
 *   INTERNATIONAL  — surfaced as "for international customers"
 *   COMING_SOON    — disabled cards for methods we haven't implemented
 *
 * Why code, not DB?  This is product intelligence (which providers are best
 * for which markets) that we tune with each PR as we learn — it changes
 * faster than schema. DB-backed recommendations would let merchants
 * override per-tenant, which is a future need; for now we ship the static
 * map and migrate to DB when there's a real "override per-tenant" request.
 *
 * Ordering within a tier: cheapest first (matches the routing engine's
 * fallback heuristic). Tier assignment can override that — e.g. UPI Direct
 * is cheaper than Stripe but is INDIA_ONLY, so for a US merchant it goes
 * to international (showing "for Indian customers") not primary.
 */

export type Tier = "primary" | "secondary" | "international" | "coming_soon"

export interface ProviderRecommendation {
  method: string                   // matches provider_method_registry.method
  tier: Tier
  reason: string                   // one-line "why this method, in your context"
  audience?: string                // for international tier: "for Indian customers", etc.
}

/**
 * Coming-soon methods — same shape per country, since the absence of
 * implementation is global. Merge into every country's list at render
 * time. Keep this list aligned with whatever isn't yet wired up in
 * checkout-router.ts (currently cashfree_* + paypal + mollie + paddle +
 * btcpay + lemonsqueezy + flutterwave + paystack + midtrans).
 */
// Cashfree intentionally NOT here — credentials capture is live at
// /providers/cashfree (Phase B3). Full payment-link auto-creation is a
// follow-up but the dashboard treats it as "configurable" today so users
// can save creds. When the sync helper lands, no change needed here.
export const COMING_SOON: ProviderRecommendation[] = [
  { method: "paypal",       tier: "coming_soon", reason: "Trusted by US/EU consumers — integration coming next quarter" },
  { method: "paddle",       tier: "coming_soon", reason: "Merchant-of-record model handles global tax — coming soon" },
  { method: "mollie",       tier: "coming_soon", reason: "EU-focused, low SEPA fees — coming soon" },
  { method: "btcpay",       tier: "coming_soon", reason: "Self-hosted crypto — coming soon" },
  { method: "lemonsqueezy", tier: "coming_soon", reason: "Lemon's MoR model for digital goods — coming soon" },
  { method: "flutterwave",  tier: "coming_soon", reason: "African markets (NG, KE, GH, etc) — coming soon" },
  { method: "paystack",     tier: "coming_soon", reason: "Nigeria-first card processing — coming soon" },
  { method: "midtrans",     tier: "coming_soon", reason: "Indonesia / SE Asia — coming soon" },
]

/**
 * Per-country recommendation lists. Lookup is uppercase ISO 3166-1 alpha-2.
 * Unknown country → DEFAULT_RECOMMENDATIONS (Stripe + UPI as the two
 * highest-coverage methods).
 *
 * Adding a country:
 *   1. Decide which methods are "primary" for a merchant THERE accepting
 *      from their LOCAL audience.
 *   2. Push international cross-border options (Stripe for Indian merchant
 *      accepting from US customers; Razorpay for US merchant accepting
 *      from Indian customers) into the "international" tier.
 *   3. Keep "reason" concise and outcome-framed ("0% fees" beats "no
 *      processor in the loop").
 */
export const RECOMMENDATIONS_BY_COUNTRY: Record<string, ProviderRecommendation[]> = {
  // -------------------------------------------------------------------- INDIA
  IN: [
    { method: "direct_upi",    tier: "primary",       reason: "0% fees, instant settlement to your bank — best for one-time products" },
    { method: "razorpay",      tier: "primary",       reason: "Hosted checkout — customer picks UPI / cards / netbanking / wallets. UPI ~0.5%, cards ~2%; supports UPI Autopay for subscriptions" },
    { method: "cashfree_upi",  tier: "secondary",     reason: "Alternative to Razorpay if you already have a Cashfree account" },
    { method: "stripe_card",   tier: "international", reason: "For customers paying in USD/EUR/GBP", audience: "international customers" },
  ],

  // -------------------------------------------------------------------- UNITED STATES
  US: [
    { method: "stripe_card",   tier: "primary",       reason: "Industry-standard for US merchants — instant onboarding, supports cards + wallets" },
    { method: "razorpay",      tier: "international", reason: "UPI + cards + netbanking via Razorpay — much lower fees than Stripe cross-border for INR", audience: "Indian customers" },
  ],

  // -------------------------------------------------------------------- CANADA (your case)
  CA: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe handles CAD-native and converts foreign cards to CAD" },
    { method: "razorpay",      tier: "international", reason: "INR-native checkout (UPI / cards / netbanking) settles to your INR account — save ~6% per Indian txn vs Stripe cross-border", audience: "Indian customers" },
    { method: "direct_upi",    tier: "international", reason: "If you have an Indian UPI VPA (personal or business), customers can pay 0% fees", audience: "Indian customers" },
  ],

  // -------------------------------------------------------------------- MEXICO
  MX: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe is the dominant card processor in MX — supports MXN and OXXO vouchers" },
    { method: "razorpay",      tier: "international", reason: "Razorpay for Indian audience — UPI + cards + netbanking", audience: "Indian customers" },
  ],

  // -------------------------------------------------------------------- UNITED KINGDOM
  GB: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe is the default for UK merchants — supports cards, BACS, and Pay by Bank" },
    { method: "razorpay",      tier: "international", reason: "Razorpay for Indian audience — UPI + cards + netbanking", audience: "Indian customers" },
  ],

  // -------------------------------------------------------------------- EU (catch-all for member states without overrides)
  DE: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe supports SEPA debit, cards, Giropay, Klarna — broadest EU coverage" },
    { method: "razorpay",      tier: "international", reason: "Razorpay for Indian audience — UPI + cards + netbanking", audience: "Indian customers" },
  ],
  FR: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe supports cards, SEPA, Bancontact — broadest FR coverage" },
    { method: "razorpay",      tier: "international", reason: "Razorpay for Indian audience — UPI + cards + netbanking", audience: "Indian customers" },
  ],
  NL: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe supports iDEAL, cards, SEPA — broadest NL coverage" },
    { method: "razorpay",      tier: "international", reason: "Razorpay for Indian audience — UPI + cards + netbanking", audience: "Indian customers" },
  ],

  // -------------------------------------------------------------------- AUSTRALIA
  AU: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe handles AUD-native processing + supports BECS direct debit" },
    { method: "razorpay",      tier: "international", reason: "Razorpay for Indian audience — UPI + cards + netbanking", audience: "Indian customers" },
  ],

  // -------------------------------------------------------------------- BRAZIL
  BR: [
    { method: "stripe_card",   tier: "primary",       reason: "Stripe supports BRL + Pix (local instant payments)" },
    { method: "razorpay",      tier: "international", reason: "Razorpay for Indian audience — UPI + cards + netbanking", audience: "Indian customers" },
  ],
}

/**
 * Fallback when the merchant hasn't picked a country yet OR they're in a
 * country we don't have specific recommendations for. We show the two most
 * universally-coverage methods (Stripe for global cards + Razorpay+UPI for
 * Indian customers if applicable) so something useful renders.
 */
export const DEFAULT_RECOMMENDATIONS: ProviderRecommendation[] = [
  { method: "stripe_card",   tier: "primary",       reason: "Works in 40+ countries — easiest universal default" },
  { method: "razorpay",      tier: "secondary",     reason: "Set this up if you have customers paying in INR (save ~6% vs Stripe)", audience: "Indian customers" },
  { method: "direct_upi",    tier: "secondary",     reason: "0% fees for Indian one-time purchases if you have a UPI VPA", audience: "Indian customers" },
]

/**
 * Resolve recommendations for a given country, merging the global
 * COMING_SOON list at the bottom. Always returns a non-empty list — the
 * UI never has to handle a "no recommendations" empty state.
 */
export function recommendationsFor(
  countryCode: string | null | undefined,
): ProviderRecommendation[] {
  const normalised = countryCode?.toUpperCase() ?? ""
  const list =
    RECOMMENDATIONS_BY_COUNTRY[normalised] ?? DEFAULT_RECOMMENDATIONS
  return [...list, ...COMING_SOON]
}

/**
 * Subset of countries we've explicitly written recommendations for —
 * powers the country picker dropdown. Anything not in this list still
 * works (falls through to DEFAULT_RECOMMENDATIONS) but doesn't get a
 * tailored experience. Adding a row here means adding it to
 * RECOMMENDATIONS_BY_COUNTRY too.
 */
export const SUPPORTED_COUNTRIES: { code: string; name: string; flag: string }[] = [
  { code: "IN", name: "India",          flag: "🇮🇳" },
  { code: "US", name: "United States",  flag: "🇺🇸" },
  { code: "CA", name: "Canada",         flag: "🇨🇦" },
  { code: "MX", name: "Mexico",         flag: "🇲🇽" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "DE", name: "Germany",        flag: "🇩🇪" },
  { code: "FR", name: "France",         flag: "🇫🇷" },
  { code: "NL", name: "Netherlands",    flag: "🇳🇱" },
  { code: "AU", name: "Australia",      flag: "🇦🇺" },
  { code: "BR", name: "Brazil",         flag: "🇧🇷" },
]
