import type Stripe from "stripe"
import { getConnectedStripeClient } from "./stripe-client"

export interface PriceInput {
  currency: string       // ISO 4217 e.g. "USD", "INR", "JPY"
  amountCents: number    // minor units; for zero-decimal currencies (JPY/KRW/etc) treat as units
}

export interface SyncProductOptions {
  /** Stripe Product ID already created by a previous sync (idempotency). */
  stripeProductId?: string
  /** currency → Stripe Price ID already created. New currencies will be added. */
  existingPrices?: Record<string, string>
}

/** Stripe-compatible billing interval. interval_count defaults to 1. */
export interface StripeInterval {
  interval: "month" | "year"
  interval_count?: number
}

/** Map app-layer interval names to Stripe recurring params. Returns null for one-time / trial products. */
export function toStripeInterval(interval: string | null | undefined): StripeInterval | null {
  switch (interval) {
    case "month": return { interval: "month" }
    case "quarter": return { interval: "month", interval_count: 3 }
    case "semiannual": return { interval: "month", interval_count: 6 }
    case "year": return { interval: "year" }
    default: return null
  }
}

export interface SyncResult {
  stripeProductId: string
  pricesByCurrency: Record<string, string>          // currency → price_id
  paymentLinksByCurrency: Record<string, string>    // currency → payment-link URL
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
])

function toStripeAmount(currency: string, amountCents: number): number {
  // Stripe expects integer minor units for non-zero-decimal currencies,
  // and integer major units for zero-decimal currencies (e.g. JPY 1100 → 1100).
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    // Caller already stores zero-decimal currencies as whole units in amountCents.
    return Math.round(amountCents)
  }
  return Math.round(amountCents)
}

/**
 * Create / update Stripe Product + Prices (per currency) + Payment Links for a PayCraft product.
 *
 * Idempotent:
 *   - Product create uses idempotencyKey paycraft:{tenant}:{product}:product
 *   - Per-currency Price creates use paycraft:{tenant}:{product}:price-{ccy}
 *   - Per-currency Payment Link uses paycraft:{tenant}:{product}:paymentlink-{ccy}
 *
 * For updates: pass `existing.stripeProductId` and `existing.existingPrices` so we only
 * add NEW currencies; existing Price objects are not modified (Stripe Prices are immutable —
 * the only way to "change" a price is to create a new one and migrate links).
 */
export async function syncProductToStripe(
  tenantId: string,
  productId: string,
  productName: string,
  productType: "subscription" | "trial" | "lifetime",
  stripeInterval: StripeInterval | null,
  prices: PriceInput[],
  existing: SyncProductOptions = {},
): Promise<SyncResult> {
  const stripe = await getConnectedStripeClient(tenantId)
  const idem = (suffix: string) => `paycraft:${tenantId}:${productId}:${suffix}`

  // 1. Product
  let stripeProductId = existing.stripeProductId
  if (!stripeProductId) {
    const product = await stripe.products.create(
      {
        name: productName,
        metadata: {
          paycraft_tenant_id: tenantId,
          paycraft_product_id: productId,
        },
      },
      { idempotencyKey: idem("product") },
    )
    stripeProductId = product.id
  } else {
    // Best-effort update (name only — other fields rare to change).
    try {
      await stripe.products.update(stripeProductId, { name: productName })
    } catch (e: any) {
      console.error("[stripe-product-sync] product update failed:", e.message)
    }
  }

  // 2. Prices (one per currency; skip if already exists for that currency).
  const pricesByCurrency: Record<string, string> = { ...(existing.existingPrices ?? {}) }
  for (const { currency, amountCents } of prices) {
    const ccyKey = currency.toUpperCase()
    if (pricesByCurrency[ccyKey]) continue

    const priceParams: Stripe.PriceCreateParams = {
      product: stripeProductId,
      currency: currency.toLowerCase(),
      unit_amount: toStripeAmount(ccyKey, amountCents),
    }
    if (productType === "subscription" && stripeInterval) {
      priceParams.recurring = {
        interval: stripeInterval.interval,
        ...(stripeInterval.interval_count && stripeInterval.interval_count > 1
          ? { interval_count: stripeInterval.interval_count }
          : {}),
      }
    }
    const price = await stripe.prices.create(priceParams, {
      idempotencyKey: idem(`price-${ccyKey}`),
    })
    pricesByCurrency[ccyKey] = price.id
  }

  // 3. Payment Links (one per Price object).
  const paymentLinksByCurrency: Record<string, string> = {}
  for (const [currency, priceId] of Object.entries(pricesByCurrency)) {
    try {
      const pl = await stripe.paymentLinks.create(
        {
          line_items: [{ price: priceId, quantity: 1 }],
          metadata: {
            paycraft_tenant_id: tenantId,
            paycraft_product_id: productId,
            currency,
          },
        },
        { idempotencyKey: idem(`paymentlink-${currency}`) },
      )
      paymentLinksByCurrency[currency] = pl.url
    } catch (e: any) {
      console.error(`[stripe-product-sync] paymentLinks.create(${currency}) failed:`, e.message)
    }
  }

  return { stripeProductId, pricesByCurrency, paymentLinksByCurrency }
}
