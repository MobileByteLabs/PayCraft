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

  // Idempotency keys are tenant+product scoped. When we self-heal a stale
  // product (account swap, key rotation), we MUST bump a generation suffix —
  // otherwise Stripe's 24h idempotency cache returns the same orphan
  // product/price/link IDs and the "heal" is silent no-op. The suffix is
  // bumped to the current epoch-day when healing fires; same-day re-runs
  // stay idempotent, next-day or post-heal runs get fresh keys.
  let healGen = ""
  const idem = (suffix: string) =>
    healGen
      ? `paycraft:${tenantId}:${productId}:${suffix}:${healGen}`
      : `paycraft:${tenantId}:${productId}:${suffix}`

  // 1. Product — with stale-ID self-heal.
  //
  // The DB may carry a stripe_product_id from a previous connection that the
  // currently-saved key can't see (different test account, key rotated, etc).
  // First touch the existing ID with a retrieve(); if Stripe says "No such
  // product" we drop the saved IDs and fall through to fresh creation. Also
  // drop the existing price map — those Price IDs belong to the orphan
  // product and won't validate either.
  let stripeProductId = existing.stripeProductId
  let usableExistingPrices = existing.existingPrices ?? {}
  if (stripeProductId) {
    try {
      await stripe.products.retrieve(stripeProductId)
      // Still valid — keep the ID, push a name update for drift recovery.
      try {
        await stripe.products.update(stripeProductId, { name: productName })
      } catch (e: any) {
        console.error("[stripe-product-sync] product update failed:", e.message)
      }
    } catch (e: any) {
      // resource_missing is the canonical Stripe code; the message contains
      // "No such product". Either is a clear signal the ID doesn't belong to
      // this account — heal silently and re-create.
      const isMissing =
        e?.code === "resource_missing" ||
        String(e?.message ?? "").includes("No such product")
      if (!isMissing) throw e
      console.warn(
        `[stripe-product-sync] stale product ID ${stripeProductId} — Stripe says "no such product"; recreating against the current account`,
      )
      stripeProductId = undefined
      usableExistingPrices = {}
      // Bump idempotency generation so the re-create doesn't return the
      // same orphan ID from Stripe's idempotency cache. Day-bucketed so
      // legitimate retries within a day stay idempotent.
      healGen = `heal-${Math.floor(Date.now() / 86_400_000)}`
    }
  }
  // 1b. Reconciliation pass — before creating a fresh product, search Stripe
  // for one that already carries our metadata fingerprint. Handles the
  // "PayCraft DB lost the ID but the product was successfully created in a
  // previous run" case (cleared row, restored backup, separate admin synced
  // via different session, etc). Adoption populates pricesByCurrency from the
  // matched product's existing Prices so we don't create duplicates.
  if (!stripeProductId) {
    try {
      const adopted = await reconcileFromStripe(stripe, tenantId, productId)
      if (adopted) {
        console.log(
          `[stripe-product-sync] adopted existing Stripe product ${adopted.productId} for PayCraft product ${productId} (found via metadata search)`,
        )
        stripeProductId = adopted.productId
        // Merge adopted prices over usableExistingPrices — adopted comes from
        // the live account and is the authoritative state.
        usableExistingPrices = { ...usableExistingPrices, ...adopted.pricesByCurrency }
      }
    } catch (e: any) {
      // Search API can return 400/403 on some account types (notably very
      // new accounts where the search index hasn't initialized). Don't block
      // sync — fall through to create.
      console.warn(
        `[stripe-product-sync] reconcile probe failed (${e?.code ?? "unknown"}): ${e?.message ?? e}; falling through to create`,
      )
    }
  }

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
  }

  // 2. Prices (one per currency; skip if already exists for that currency).
  const pricesByCurrency: Record<string, string> = { ...usableExistingPrices }
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

  // 3. Payment Links — reconcile first, then create missing ones per Price.
  // The reconcile pass searches Stripe for existing links by metadata; any
  // currency we find a link for already, we adopt instead of recreating.
  const paymentLinksByCurrency: Record<string, string> = {}
  try {
    const adoptedLinks = await reconcilePaymentLinks(stripe, tenantId, productId)
    Object.assign(paymentLinksByCurrency, adoptedLinks)
    if (Object.keys(adoptedLinks).length > 0) {
      console.log(
        `[stripe-product-sync] adopted ${Object.keys(adoptedLinks).length} existing payment link(s) for PayCraft product ${productId}`,
      )
    }
  } catch (e: any) {
    console.warn(
      `[stripe-product-sync] payment-link reconcile probe failed: ${e?.message ?? e}; falling through to create`,
    )
  }
  for (const [currency, priceId] of Object.entries(pricesByCurrency)) {
    if (paymentLinksByCurrency[currency]) continue
    try {
      const pl = await stripe.paymentLinks.create(
        {
          line_items: [{ price: priceId, quantity: 1 }],
          // Enable promotion codes so PayCraft's SDK can append
          // `?prefilled_promo_code=…` at checkout time. Without this flag,
          // Stripe Payment Links ignore the parameter — the customer would
          // never see the discount applied. See SDK PayCraft.appendCouponParam.
          allow_promotion_codes: true,
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

/**
 * Adoption pass — search Stripe for a Product carrying our metadata
 * fingerprint, and if found, also collect all its existing Prices.
 *
 * This handles the "PayCraft DB lost the ID but the artifacts still exist"
 * case: clearing a row, restoring an older backup, syncing from a parallel
 * session, or operator manually deleting `stripe_product_id` to force a
 * re-pull. Without adoption we'd happily create a SECOND product with the
 * same metadata — silently doubling everything on Stripe.
 *
 * Returns null when no match (typical first-time sync). Returns the
 * product + price-by-currency map when adoption succeeds. Recurring +
 * one-time prices are both pulled in — the caller can ignore mismatches.
 *
 * NOTE: Stripe's Search API has a ~minute indexing lag for newly-created
 * products. Adoption is therefore best-effort — if a product was created
 * 30s ago by another session it may not show up here. The idempotency-key
 * fallback catches that case at creation time.
 */
async function reconcileFromStripe(
  stripe: Stripe,
  tenantId: string,
  productId: string,
): Promise<{ productId: string; pricesByCurrency: Record<string, string> } | null> {
  const query = `metadata['paycraft_product_id']:'${productId}' AND metadata['paycraft_tenant_id']:'${tenantId}'`
  const result = await stripe.products.search({ query, limit: 5 })
  if (result.data.length === 0) return null
  // Prefer the most recent active product if multiple matched (shouldn't
  // happen, but if a botched run created duplicates this picks one).
  const sorted = [...result.data].sort(
    (a, b) => (b.created ?? 0) - (a.created ?? 0),
  )
  const productMatch = sorted.find((p) => p.active) ?? sorted[0]
  if (!productMatch) return null

  // Pull every Price for this product so we don't recreate per-currency
  // duplicates. Paginate up to 100 — sufficient for the per-currency matrix
  // PayCraft generates (typically ≤30 currencies).
  const pricesByCurrency: Record<string, string> = {}
  const priceList = await stripe.prices.list({ product: productMatch.id, limit: 100 })
  for (const price of priceList.data) {
    if (!price.active) continue
    const ccy = (price.currency ?? "").toUpperCase()
    if (!ccy) continue
    // First active match per currency wins — Stripe lists newest first,
    // so this picks the freshest active Price.
    if (!pricesByCurrency[ccy]) pricesByCurrency[ccy] = price.id
  }
  return { productId: productMatch.id, pricesByCurrency }
}

/**
 * Adoption pass for Payment Links — uses the search API the same way as
 * reconcileFromStripe but on the paymentLinks resource. Returns a
 * currency → URL map for every active link Stripe already has under our
 * metadata fingerprint. Currencies not present in the map get newly
 * created by the caller.
 */
async function reconcilePaymentLinks(
  stripe: Stripe,
  tenantId: string,
  productId: string,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  // paymentLinks doesn't have a search() method on every Stripe SDK
  // version; iterate with list() + metadata filter instead. We cap the
  // page at 100 — operators with more than 100 active payment links per
  // tenant are an edge case worth handling separately.
  const list = await stripe.paymentLinks.list({ limit: 100, active: true })
  for (const pl of list.data) {
    const meta = pl.metadata ?? {}
    if (
      meta.paycraft_tenant_id === tenantId &&
      meta.paycraft_product_id === productId
    ) {
      const ccy = (meta.currency ?? "").toString().toUpperCase()
      if (!ccy) continue
      if (!out[ccy]) out[ccy] = pl.url
    }
  }
  return out
}
