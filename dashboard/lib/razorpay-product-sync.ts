import { getConnectedRazorpayClient } from "./razorpay-client"

export interface RazorpayPriceInput {
  currency: string    // ISO 4217 (e.g. INR, USD)
  amountCents: number // minor units
}

export interface RazorpaySyncResult {
  planIdsByCurrency: Record<string, string>          // currency → plan_id (subscriptions)
  paymentLinksByCurrency: Record<string, string>     // currency → short_url (one-time / trial)
}

// PayCraft billing intervals as stored on tenant_products.interval.
export type BillingInterval = "month" | "quarter" | "semiannual" | "year"

/**
 * Map a PayCraft billing interval to a Razorpay Plan cadence.
 *
 * Razorpay's `period` enum is { daily, weekly, monthly, quarterly, yearly } and
 * the cadence between charges is `period × interval` (the multiplier). There is
 * no native half-yearly period, so semiannual is expressed as monthly × 6.
 *
 * The previous mapping collapsed everything that wasn't "month" to yearly × 1,
 * which silently created Pro Quarterly / Pro Semiannual plans that billed once a
 * year — a real revenue mismatch. We map each interval explicitly and throw on
 * anything unrecognised rather than guess (the caller reports it as a failed
 * sync instead of minting a wrong-cadence plan that can't be edited afterwards).
 */
function razorpayPlanCadence(
  interval: BillingInterval | string | null,
): { period: "monthly" | "quarterly" | "yearly"; multiplier: number } {
  switch (interval) {
    case "month":
      return { period: "monthly", multiplier: 1 }
    case "quarter":
      return { period: "quarterly", multiplier: 1 }
    case "semiannual":
      return { period: "monthly", multiplier: 6 } // Razorpay has no half-yearly period
    case "year":
      return { period: "yearly", multiplier: 1 }
    default:
      throw new Error(
        `unsupported subscription interval for Razorpay plan: ${String(interval)}`,
      )
  }
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
  interval: BillingInterval | string | null,
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

      const { period, multiplier } = razorpayPlanCadence(interval)
      const plan = await (client as any).plans.create({
        period,
        interval: multiplier,
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
