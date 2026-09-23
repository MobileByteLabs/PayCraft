import type { SupabaseClient } from "@supabase/supabase-js"
import { getConnectedRazorpayClient } from "./razorpay-client"

export interface RazorpayPriceInput {
  currency: string    // ISO 4217 (e.g. INR, USD)
  amountCents: number // minor units
}

export interface RazorpaySyncResult {
  planIdsByCurrency: Record<string, string>          // currency → plan_id (subscriptions)
  paymentLinksByCurrency: Record<string, string>     // currency → short_url (one-time / trial)
  skippedCurrencies: string[]                        // currencies Razorpay rejected (e.g. USD on an INR-only account)
  /**
   * `currency:plan_id` entries that were stored locally but did NOT exist at Razorpay, and were
   * recreated. A non-empty list means local state had drifted from the provider — worth telling the
   * operator, because it usually means the account or the key mode changed underneath them.
   */
  recreatedPlanIds: string[]
  /**
   * currency → why the subscription CHECKOUT link could not be created, when the plan itself was.
   *
   * A plan is the artifact that proves the sync ran; a registration link is the artifact the paywall
   * CTA actually opens. Losing the second while keeping the first is invisible in every downstream
   * check — /config still serves a razorpay binding, the drift report sees plan ids and calls the
   * provider served — and it surfaces only as "Continue does nothing" on a device.
   */
  linkFailuresByCurrency: Record<string, string>
}

// PayCraft billing intervals as stored on tenant_products.interval.
export type BillingInterval = "month" | "quarter" | "semiannual" | "year"

/**
 * Map a PayCraft billing interval to a Razorpay Plan cadence.
 *
 * Razorpay's Plan `period` enum is ONLY { daily, weekly, monthly, yearly } — there
 * is NO `quarterly` and no half-yearly. The cadence between charges is
 * `period × interval` (the multiplier), so quarterly and semiannual are both
 * expressed as monthly × N. Verified live: a `quarterly` period 400s with
 * "Invalid argument for period passed", while monthly × 6 is accepted.
 *
 * The original mapping collapsed everything that wasn't "month" to yearly × 1,
 * which silently created Pro Quarterly / Pro Semiannual plans that billed once a
 * year — a real revenue mismatch. We map each interval explicitly and throw on
 * anything unrecognised rather than guess (the caller reports it as a failed
 * sync instead of minting a wrong-cadence plan that can't be edited afterwards).
 */
function razorpayPlanCadence(
  interval: BillingInterval | string | null,
): { period: "monthly" | "yearly"; multiplier: number } {
  switch (interval) {
    case "month":
      return { period: "monthly", multiplier: 1 }
    case "quarter":
      return { period: "monthly", multiplier: 3 }
    case "semiannual":
      return { period: "monthly", multiplier: 6 }
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
  /**
   * Client for credential lookups. Threaded from the caller so a machine-authenticated request
   * (management API, service role) does not fall back to a cookie session that does not exist.
   */
  supa?: SupabaseClient<any>,
): Promise<RazorpaySyncResult> {
  const client = await getConnectedRazorpayClient(tenantId, mode, supa)
  const planIdsByCurrency: Record<string, string> = { ...existingPlanIds }
  const paymentLinksByCurrency: Record<string, string> = {}
  const skippedCurrencies: string[] = []
  const linkFailuresByCurrency: Record<string, string> = {}
  /** Plan ids this tenant had stored that no longer exist at Razorpay — recreated this run. */
  const verifiedMissing: string[] = []

  // Razorpay rejects currencies the account isn't enabled for (e.g. USD on an
  // INR-only account) with a 400 "Currency provided is not supported". We skip
  // such currencies and keep going so supported currencies (INR) still sync;
  // ANY other error (bad period, auth, etc.) is a real failure and propagates.
  const isUnsupportedCurrencyError = (e: any): boolean =>
    /currency/i.test(String(e?.error?.description ?? e?.message ?? ""))

  for (const { currency, amountCents } of prices) {
    const ccyKey = currency.toUpperCase()

    try {
      if (productType === "subscription" && interval) {
        // Skip the PLAN when one already exists — but NOT the rest of this block.
        //
        // This used to be `if (planIdsByCurrency[ccyKey]) continue`, which skipped the whole
        // iteration including the auth-link creation below. The consequence was a product that
        // could never be repaired: once the plan existed, every re-sync jumped straight past the
        // link step and reported "razorpay: ok", while `live_payment_links` stayed `{sku: {}}` and
        // the paywall CTA had nothing to open. Re-syncing is the operator's only lever, and it was
        // a no-op for the exact state that needed fixing.
        // VERIFY, don't assume. A stored plan id is a claim about the PROVIDER's state, and this
        // code previously trusted it absolutely: `if (planIdsByCurrency[ccyKey]) continue`. That is
        // wrong in both directions — a plan deleted at Razorpay, or written by a sync against a
        // DIFFERENT account (test keys swapped for live, a re-connected merchant), leaves an id here
        // that resolves to nothing there. Every later sync then reports "ok" while the catalogue is
        // broken, and the failure only appears at checkout.
        //
        // One GET per currency confirms the id is real before it is reused. On a 404 the id is
        // discarded and recreated; any other error (auth, network) is left to the outer handler
        // rather than silently recreating a plan that may well exist.
        let planId = planIdsByCurrency[ccyKey]
        if (planId) {
          try {
            const existing = await (client as any).plans.fetch(planId)
            if (!existing?.id) planId = ""
          } catch (e: any) {
            if (e?.statusCode === 400 || e?.statusCode === 404) {
              verifiedMissing.push(`${ccyKey}:${planId}`)
              planId = ""
              delete planIdsByCurrency[ccyKey]
            } else {
              throw e
            }
          }
        }
        if (!planId) {
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
          planId = plan.id
          planIdsByCurrency[ccyKey] = planId
        }

        // A RECURRING AUTH LINK CANNOT BE CREATED HERE, AND THAT IS NOT A BUG TO RETRY.
        //
        // Razorpay answers this call with "The contact field is required for recurring links",
        // because an auth link authorises ONE customer's mandate — it carries their contact, email
        // and name. At catalogue-sync time there is no customer, so no payload can satisfy it. A
        // reusable product-level link for a subscription does not exist in Razorpay's model.
        //
        // The correct lane is per-customer at checkout: razorpay-subscription-initiator.ts creates
        // a Subscription for the chosen plan and returns its short_url, which is what the buyer
        // opens. Recording that plainly is worth more than another failed attempt — it used to be a
        // bare `catch {}`, so the sync reported "ok" and the paywall CTA silently had nothing to
        // open, with nothing anywhere connecting the two facts.
        // States the Razorpay fact only. WHERE checkout comes from is the caller's sentence, so the
        // two do not repeat each other in one message.
        linkFailuresByCurrency[ccyKey] =
          "Razorpay binds an auth link to one customer, so a recurring plan has no reusable link"
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
    } catch (e: any) {
      if (isUnsupportedCurrencyError(e)) {
        skippedCurrencies.push(ccyKey)
        continue
      }
      throw e
    }
  }

  return {
    planIdsByCurrency,
    paymentLinksByCurrency,
    skippedCurrencies,
    linkFailuresByCurrency,
    recreatedPlanIds: verifiedMissing,
  }
}
