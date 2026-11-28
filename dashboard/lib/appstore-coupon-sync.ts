import { couponPeriodCount } from "./coupon-periods"
import { createClient } from "./supabase-server"
import { appStoreConnectToken, type AppStoreConnectCreds } from "./store-jwt"
import { ascFetch, resolveAscSubscriptionId } from "./appstore-product-sync"

/**
 * Apply a PayCraft coupon (percent_off) to a tenant's App Store subscriptions as a PAY_AS_YOU_GO PROMOTIONAL offer
 * at a discounted price point — the StoreKit equivalent of a coupon, given only to the buyer the server signs it for
 * (`winback` → `signPromotionalOffer`, keyed by the offer code stored here in `appstore_offer_ids`).
 *
 * It used to create an INTRODUCTORY offer: Apple applies those to EVERY new subscriber, so a win-back coupon became a
 * public discount, and its id could not be signed as a promotional offer (the lane never worked).
 *
 * Per product: one promotional offer per applicable subscription with an app_store_product_id, its length counted in
 * the subscription's own period (`couponPeriodCount`; a plan the duration doesn't fit is skipped). Best-effort —
 * failures are recorded, never surface to the CRUD flow (parity with Stripe / Razorpay / Play coupon sync).
 * Platform limits (documented, not bugs): Apple's fixed price-point ladder (the discount snaps to the nearest USA
 * point) and this resolves the USA price only — other territories follow Apple's equalization.
 */

/** The subscription's billing period → Apple offer duration (a PAY_AS_YOU_GO offer runs in the plan's own period). */
export function ascPeriodDuration(interval: string | null): string {
  switch ((interval ?? "month").toLowerCase()) {
    case "year": return "ONE_YEAR"
    case "semiannual": return "SIX_MONTHS"
    case "quarter": return "THREE_MONTHS"
    case "week": return "ONE_WEEK"
    default: return "ONE_MONTH"
  }
}

/** The promotional offer identifier StoreKit names: the coupon code, made safe ([a-z0-9_.], ≤ 64). */
export function promoOfferCode(code: string): string {
  return `cpn.${code}`.toLowerCase().replace(/[^a-z0-9_.]/g, "_").slice(0, 64)
}

/** The ASC request that creates [offerCode] on [subId] at [pricePointId] for [periods] of [interval]. */
export function promotionalOfferBody(opts: {
  subId: string
  offerCode: string
  name: string
  interval: string | null
  periods: number
  pricePointId: string
}) {
  return {
    data: {
      type: "subscriptionPromotionalOffers",
      attributes: {
        name: opts.name.slice(0, 60),
        offerCode: opts.offerCode,
        offerMode: "PAY_AS_YOU_GO",
        duration: ascPeriodDuration(opts.interval),
        numberOfPeriods: opts.periods,
      },
      relationships: {
        subscription: { data: { type: "subscriptions", id: opts.subId } },
        prices: { data: [{ type: "subscriptionPromotionalOfferPrices", id: "${price-usa}" }] },
      },
    },
    included: [
      {
        type: "subscriptionPromotionalOfferPrices",
        id: "${price-usa}",
        relationships: {
          territory: { data: { type: "territories", id: "USA" } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: opts.pricePointId } },
        },
      },
    ],
  }
}

export async function syncCouponToAppStore(opts: {
  tenantId: string
  couponRowId: string
  code: string
  percentOff: number
  duration: "once" | "repeating" | "forever"
  durationInMonths: number | null
  appliesToProductIds: string[] | null
}): Promise<{ offerIdsByProduct: Record<string, string>; skipped?: string[] } | null> {
  const supabase = createClient()

  // 1. App Store connected + decrypt the .p8 + issuer/key ids.
  const { data: status } = await supabase
    .rpc("tenant_providers_store_status", { p_tenant_id: opts.tenantId, p_provider: "app_store" })
    .single<{ connected: boolean; config: Record<string, any> }>()
  if (!status?.connected) return null

  const { data: decrypted } = await supabase
    .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: opts.tenantId, p_provider: "app_store" })
    .single<{ credential: string | null; config: Record<string, any> }>()
  const cfg = decrypted?.config ?? {}
  if (!decrypted?.credential || !cfg.key_id || !cfg.issuer_id || !cfg.bundle_id) return null
  const bundleId = cfg.bundle_id as string

  const creds: AppStoreConnectCreds = {
    keyId: cfg.key_id,
    issuerId: cfg.issuer_id,
    privateKeyP8: decrypted.credential,
  }
  const token = await appStoreConnectToken(creds)

  // 2. Applicable subscription products synced to the App Store.
  let q = supabase
    .from("tenant_products")
    .select("id, app_store_product_id, interval, type")
    .eq("tenant_id", opts.tenantId)
    .eq("type", "subscription")
    .not("app_store_product_id", "is", null)
  if (opts.appliesToProductIds && opts.appliesToProductIds.length > 0) {
    q = q.in("id", opts.appliesToProductIds)
  }
  const { data: products } = await q
  if (!products || products.length === 0) return { offerIdsByProduct: {} }

  const { data: pricing } = await supabase
    .from("tenant_pricing")
    .select("product_id, amount_cents, currency")
    .in("product_id", products.map((p) => p.id))
  // USD base price per product (Apple price points resolved in USA).
  const usdByProduct = new Map<string, number>()
  for (const row of pricing ?? []) {
    if (String(row.currency).toUpperCase() === "USD" && !usdByProduct.has(row.product_id)) {
      usdByProduct.set(row.product_id, row.amount_cents)
    }
  }

  const offerCode = promoOfferCode(opts.code)
  const offerIdsByProduct: Record<string, string> = {}
  const errors: string[] = []
  for (const prod of products) {
    const periods = couponPeriodCount(opts.duration, opts.durationInMonths, prod.interval ?? null)
    if (periods === null) {
      errors.push(`${prod.app_store_product_id}: a ${opts.durationInMonths}-month discount doesn't fit a ${prod.interval} plan`)
      continue
    }
    const baseCents = usdByProduct.get(prod.id)
    if (!baseCents) { errors.push(`${prod.app_store_product_id}: no USD price`); continue }

    // Resolve the ASC RESOURCE id from the stored product reference id — the
    // pricePoints / promotionalOffers endpoints 404 on the reference name.
    const subId = await resolveAscSubscriptionId(token, bundleId, prod.app_store_product_id as string)
    if (!subId) {
      errors.push(`${prod.app_store_product_id}: could not resolve ASC subscription`)
      continue
    }

    // Idempotent: an offer with this code already on the subscription is reused (offers can't be edited in place).
    const listRes = await ascFetch(token, `/v1/subscriptions/${subId}/promotionalOffers?limit=200`)
    if (listRes.ok) {
      const existing: any[] = (await listRes.json()).data ?? []
      if (existing.some((o) => o?.attributes?.offerCode === offerCode)) {
        offerIdsByProduct[prod.id] = offerCode
        continue
      }
    }

    // The nearest USA price point to the discounted amount.
    const targetUsd = Math.max(0.01, (baseCents * (1 - opts.percentOff / 100)) / 100)
    const ppRes = await ascFetch(token, `/v1/subscriptions/${subId}/pricePoints?filter[territory]=USA&limit=200`)
    if (!ppRes.ok) {
      errors.push(`${subId}: price points ${ppRes.status}`)
      continue
    }
    const points: any[] = (await ppRes.json()).data ?? []
    let best: any = null
    let bestDelta = Number.POSITIVE_INFINITY
    for (const point of points) {
      const price = parseFloat(point?.attributes?.customerPrice ?? "NaN")
      if (!Number.isFinite(price)) continue
      const delta = Math.abs(price - targetUsd)
      if (delta < bestDelta) { bestDelta = delta; best = point }
    }
    if (!best) { errors.push(`${subId}: no USA price point`); continue }

    const createRes = await ascFetch(token, `/v1/subscriptionPromotionalOffers`, {
      method: "POST",
      body: JSON.stringify(promotionalOfferBody({
        subId, offerCode, name: `${opts.code} coupon`, interval: prod.interval ?? null, periods, pricePointId: best.id,
      })),
    })
    if (!createRes.ok) {
      errors.push(`${subId}: create ${createRes.status} ${(await createRes.text()).replace(/\s+/g, " ").slice(0, 160)}`)
      continue
    }
    // StoreKit (and the server's signature) name the offer by its code, not its ASC resource id.
    offerIdsByProduct[prod.id] = offerCode
  }

  if (Object.keys(offerIdsByProduct).length > 0) {
    await supabase
      .from("tenant_coupons")
      .update({ appstore_offer_ids: offerIdsByProduct, updated_at: new Date().toISOString() })
      .eq("id", opts.couponRowId)
  }
  // Skips (a duration a plan can't carry, no USD price) are expected platform constraints — record, never fail.
  return { offerIdsByProduct, skipped: errors }
}

export async function syncCouponBestEffort(args: Parameters<typeof syncCouponToAppStore>[0]) {
  try {
    await syncCouponToAppStore(args)
  } catch (e: any) {
    console.error("[appstore-coupon-sync] failed:", e?.message ?? e)
  }
}
