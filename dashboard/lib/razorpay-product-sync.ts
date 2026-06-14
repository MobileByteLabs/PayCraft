import { getConnectedRazorpayClient } from "./razorpay-client"

export interface RazorpayPriceInput {
  currency: string    // ISO 4217 (e.g. INR, USD)
  amountCents: number // minor units
}

export interface RazorpaySyncResult {
  planIdsByCurrency: Record<string, string>          // currency → plan_id (subscriptions)
  paymentLinksByCurrency: Record<string, string>     // currency → short_url (one-time / trial)
}

/**
 * Create Razorpay Plans (for recurring) or Payment Links (for one-time / trial) per currency.
 * Idempotent per currency — callers should pass existingPlanIds to skip re-creation.
 */
export async function syncProductToRazorpay(
  tenantId: string,
  productId: string,
  productName: string,
  productType: "subscription" | "trial" | "lifetime",
  interval: "month" | "year" | null,
  prices: RazorpayPriceInput[],
  mode: "test" | "live" = "live",
  existingPlanIds: Record<string, string> = {},
): Promise<RazorpaySyncResult> {
  const client = await getConnectedRazorpayClient(tenantId, mode)
  const planIdsByCurrency: Record<string, string> = { ...existingPlanIds }
  const paymentLinksByCurrency: Record<string, string> = {}

  for (const { currency, amountCents } of prices) {
    const ccyKey = currency.toUpperCase()

    if (productType === "subscription" && interval) {
      // Skip if plan already exists for this currency.
      if (planIdsByCurrency[ccyKey]) continue

      const plan = await (client as any).plans.create({
        period: interval === "month" ? "monthly" : "yearly",
        interval: 1,
        item: {
          name: productName,
          amount: amountCents,
          currency: ccyKey,
          description: productName,
        },
        notes: {
          paycraft_tenant_id: tenantId,
          paycraft_product_id: productId,
        },
      })
      planIdsByCurrency[ccyKey] = plan.id

      // Create a subscription link (Razorpay's equivalent of a payment link for subscriptions)
      try {
        const link = await (client as any).subscriptionRegistration.createRegistrationLink({
          type: "link",
          amount: amountCents,
          currency: ccyKey,
          description: productName,
          subscription_registration: {
            method: "emandate",
            auth_type: "netbanking",
          },
          notify: { sms: true, email: true },
        })
        paymentLinksByCurrency[ccyKey] = link.short_url
      } catch {
        // Subscription links are optional — don't fail the whole sync
      }
    } else {
      // One-time payment link for lifetime / trial products
      const link = await (client as any).paymentLink.create({
        amount: amountCents,
        currency: ccyKey,
        description: productName,
        notify: { sms: true, email: true },
        notes: {
          paycraft_tenant_id: tenantId,
          paycraft_product_id: productId,
        },
      })
      paymentLinksByCurrency[ccyKey] = link.short_url
    }
  }

  return { planIdsByCurrency, paymentLinksByCurrency }
}
