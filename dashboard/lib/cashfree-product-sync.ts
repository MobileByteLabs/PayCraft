import {
  cashfreeCreatePaymentLink,
  cashfreeGetPaymentLink,
  type PaymentLinkResponse,
} from "./cashfree-client"

/**
 * Cashfree product sync — creates a Payment Link per currency for a given
 * PayCraft product.
 *
 * Cashfree Payment Links are scoped to INR only (Cashfree settles only in
 * INR), so the "per currency" iteration collapses to one link per product.
 * The signature matches stripeProductSync / razorpayProductSync for
 * consistency in the route helper.
 *
 * Idempotency: `link_id` is a tenant+product hash so re-running for the
 * same product reuses the existing link instead of creating a duplicate.
 * If Cashfree returns 409 (link already exists with that id) we fetch the
 * existing one and adopt its URL.
 */

export interface PriceInput {
  currency: string
  amountCents: number
}

export interface CashfreeSyncOptions {
  existingLinks?: Record<string, string>  // currency → link URL already saved
}

export interface CashfreeSyncResult {
  paymentLinksByCurrency: Record<string, string>
  planIdsByCurrency: Record<string, string>  // empty for now — UPI Autopay TODO
}

function linkId(tenantId: string, productId: string, currency: string): string {
  // Cashfree allows alphanumeric + underscore + hyphen, up to 40 chars.
  return `pc-${tenantId.slice(0, 8)}-${productId.slice(0, 8)}-${currency.toLowerCase()}`.slice(0, 40)
}

export async function syncProductToCashfree(
  tenantId: string,
  productId: string,
  productName: string,
  productType: "subscription" | "trial" | "lifetime",
  prices: PriceInput[],
  appId: string,
  secret: string,
  mode: "test" | "live",
  existing: CashfreeSyncOptions = {},
): Promise<CashfreeSyncResult> {
  // Subscription products: defer to Cashfree's /pg/subscriptions API which
  // we haven't implemented yet. Surface this clearly so the caller knows
  // why no link gets created instead of silently returning empty.
  if (productType === "subscription") {
    console.warn(
      `[cashfree-product-sync] skipping subscription product ${productId} — UPI Autopay setup not yet implemented; use Razorpay or Stripe for recurring`,
    )
    return { paymentLinksByCurrency: {}, planIdsByCurrency: {} }
  }

  const paymentLinksByCurrency: Record<string, string> = {
    ...(existing.existingLinks ?? {}),
  }

  for (const { currency, amountCents } of prices) {
    const ccyKey = currency.toUpperCase()
    if (ccyKey !== "INR") {
      // Cashfree settles only in INR. Other currencies aren't supported by
      // /pg/links; skip silently.
      continue
    }
    if (paymentLinksByCurrency[ccyKey]) continue

    const id = linkId(tenantId, productId, ccyKey)
    const amountRupees = amountCents / 100

    let link: PaymentLinkResponse | null = null
    try {
      link = await cashfreeCreatePaymentLink(
        { appId, secret, mode },
        {
          link_id: id,
          link_amount: amountRupees,
          link_currency: "INR",
          link_purpose: productName,
          customer_details: {},
          link_notes: {
            paycraft_tenant_id: tenantId,
            paycraft_product_id: productId,
            currency: ccyKey,
          },
        },
      )
    } catch (e: any) {
      // Cashfree returns "link_id already exists" with a 409. Adoption
      // path: fetch the existing link and use its URL.
      if (String(e?.message ?? "").includes("already exists") || String(e).includes("409")) {
        link = await cashfreeGetPaymentLink({ appId, secret, mode }, id).catch(
          () => null,
        )
      } else {
        console.error(`[cashfree-product-sync] create link failed:`, e.message)
        continue
      }
    }

    if (link?.link_url) {
      paymentLinksByCurrency[ccyKey] = link.link_url
    }
  }

  return { paymentLinksByCurrency, planIdsByCurrency: {} }
}
