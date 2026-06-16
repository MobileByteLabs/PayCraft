/**
 * Resolve "is this method connected for this tenant?" for the dashboard's
 * provider cards.
 *
 * Different methods live in different tables:
 *   - direct_upi          → tenant_payment_methods (custom config)
 *   - stripe_card         → tenant_providers OR tenant_stripe_connect
 *   - razorpay_*          → tenant_providers
 *   - cashfree_*          → tenant_providers (future)
 *   - paypal/paddle/mollie/btcpay/lemonsqueezy/flutterwave/paystack/midtrans
 *                         → tenant_providers (future) or not-yet-implemented
 *
 * Centralising here so the dashboard page doesn't duplicate this logic per
 * card.
 */

export type MethodState = "connected" | "configurable" | "coming_soon"

export interface MethodStateInputs {
  /** Returns true if a tenant_payment_methods row exists with enabled=true */
  tenantPaymentMethods: Set<string>
  /** Set of provider names that have a tenant_providers row */
  tenantProviders: Set<string>
  /** True when tenant_stripe_connect (OAuth) is present */
  stripeOAuthConnected: boolean
}

/**
 * Decide the state for one method given the loaded tenant config maps.
 *
 *   connected     — the merchant has finished setup
 *   configurable  — implementable today but not yet set up
 *   coming_soon   — we don't have integration code yet (disabled card)
 */
export function methodState(
  method: string,
  inputs: MethodStateInputs,
): MethodState {
  switch (method) {
    case "direct_upi":
      return inputs.tenantPaymentMethods.has("direct_upi")
        ? "connected"
        : "configurable"

    case "stripe_card":
      return inputs.tenantProviders.has("stripe") || inputs.stripeOAuthConnected
        ? "connected"
        : "configurable"

    case "razorpay":
      return inputs.tenantProviders.has("razorpay") ? "connected" : "configurable"

    case "cashfree_card":
      // Reserved for future explicit-card method registry entry.
      return inputs.tenantProviders.has("cashfree") ? "connected" : "configurable"

    case "cashfree_upi":
      // Credentials capture page is live (/providers/cashfree). Full
      // payment-link auto-creation is the follow-up; for now "connected"
      // means keys are saved even if the router still falls through.
      return inputs.tenantProviders.has("cashfree") ? "connected" : "configurable"

    case "paypal":
    case "paddle":
    case "mollie":
    case "btcpay":
    case "lemonsqueezy":
    case "flutterwave":
    case "paystack":
    case "midtrans":
      // No integration code yet. These get rendered as disabled "Coming
      // soon" cards. When implementation lands, flip to a real branch.
      return "coming_soon"

    default:
      // Unknown method — defensive default. Shouldn't happen if the
      // recommendations registry stays in sync with the method registry.
      return "coming_soon"
  }
}

/**
 * Routes the configure CTA on each card to the right destination.
 * `null` means there's no setup page yet (use disabled state instead).
 */
export function setupPathFor(method: string): string | null {
  switch (method) {
    case "direct_upi":
      return "/providers/upi"
    case "stripe_card":
      return "/providers/stripe"
    case "razorpay":
      return "/providers/razorpay"
    case "cashfree_upi":
    case "cashfree_card":
      return "/providers/cashfree"
    default:
      return null
  }
}

/**
 * Human-readable brand label per method. Used as the card title.
 */
export function methodBrand(method: string): { name: string; subtitle?: string } {
  switch (method) {
    case "direct_upi":
      return { name: "UPI Direct", subtitle: "Personal or business VPA" }
    case "stripe_card":
      return { name: "Stripe", subtitle: "Cards, wallets, bank debits" }
    case "razorpay":
      return { name: "Razorpay", subtitle: "UPI + cards + netbanking + wallets — supports UPI Autopay for subs" }
    case "cashfree_upi":
      return { name: "Cashfree", subtitle: "UPI + cards + netbanking (IN)" }
    case "paypal":
      return { name: "PayPal", subtitle: "Trusted by US/EU consumers" }
    case "paddle":
      return { name: "Paddle", subtitle: "Merchant-of-record for digital goods" }
    case "mollie":
      return { name: "Mollie", subtitle: "EU-focused, iDEAL + SEPA" }
    case "btcpay":
      return { name: "BTCPay", subtitle: "Self-hosted crypto" }
    case "lemonsqueezy":
      return { name: "Lemon Squeezy", subtitle: "MoR for SaaS + digital" }
    case "flutterwave":
      return { name: "Flutterwave", subtitle: "African markets" }
    case "paystack":
      return { name: "Paystack", subtitle: "Nigeria-first cards" }
    case "midtrans":
      return { name: "Midtrans", subtitle: "Indonesia / SE Asia" }
    default:
      return { name: method }
  }
}
