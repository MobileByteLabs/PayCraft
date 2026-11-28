import { couponPeriodCount } from "./coupon-periods"
import { createClient } from "./supabase-server"
import { playAccessToken, type PlayServiceAccountJson } from "./store-jwt"
import {
  CURRENCY_REGION,
  REGIONS_VERSION,
  basePlanIdFor,
  playBillingPeriod,
  playFetch,
  resolveRegions,
  shortPlayError,
  toPlayMoney,
  type GooglePlayPriceInput,
} from "./googleplay-product-sync"

/**
 * Apply a PayCraft coupon (percent_off) to a tenant's Google Play subscriptions
 * as a DISCOUNTED base-plan OFFER — the Play equivalent of a coupon. Mirrors the
 * FREE_TRIAL offer flow in googleplay-product-sync.ts, but the phase carries a
 * discounted PRICE instead of `free: {}`.
 *
 * Per-product: one discount offer per applicable subscription that has a
 * play_product_id. Best-effort — failures are logged, never surface to the CRUD
 * flow (parity with the Stripe/Razorpay coupon sync).
 *
 * Platform limits (documented, not bugs): Play offer phases are finite, so
 * `duration: "forever"` is capped at 12 recurrences; the discount applies to
 * NEW subscribers (acquisition offer); recurrenceCount is expressed in the base
 * plan's own billing period.
 */

function couponOfferIdFor(basePlanId: string, code: string): string {
  return `${basePlanId}-cpn-${code}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 63).replace(/-+$/g, "")
}

interface ApplicableProduct {
  productId: string
  playProductId: string
  interval: string | null
  prices: GooglePlayPriceInput[]
}

export async function syncCouponToGooglePlay(opts: {
  tenantId: string
  couponRowId: string
  code: string
  percentOff: number
  duration: "once" | "repeating" | "forever"
  durationInMonths: number | null
  appliesToProductIds: string[] | null
}): Promise<{ offerIdsByProduct: Record<string, string>; skipped?: string[] } | null> {
  const supabase = createClient()

  // 1. Google Play connected + decrypt the service-account credential.
  const { data: status } = await supabase
    .rpc("tenant_providers_store_status", { p_tenant_id: opts.tenantId, p_provider: "google_play" })
    .single<{ connected: boolean; config: Record<string, any> }>()
  if (!status?.connected) return null

  const { data: decrypted } = await supabase
    .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: opts.tenantId, p_provider: "google_play" })
    .single<{ credential: string | null; config: Record<string, any> }>()
  const pkg = decrypted?.config?.package_name
  if (!decrypted?.credential || !pkg) return null

  // 2. Applicable subscription products that have been synced to Play.
  let q = supabase
    .from("tenant_products")
    .select("id, play_product_id, interval, type")
    .eq("tenant_id", opts.tenantId)
    .eq("type", "subscription")
    .not("play_product_id", "is", null)
  if (opts.appliesToProductIds && opts.appliesToProductIds.length > 0) {
    q = q.in("id", opts.appliesToProductIds)
  }
  const { data: products } = await q
  if (!products || products.length === 0) return { offerIdsByProduct: {} }

  const { data: pricing } = await supabase
    .from("tenant_pricing")
    .select("product_id, amount_cents, currency")
    .in("product_id", products.map((p) => p.id))
  const pricesByProduct = new Map<string, GooglePlayPriceInput[]>()
  for (const row of pricing ?? []) {
    const list = pricesByProduct.get(row.product_id) ?? []
    list.push({ currency: row.currency, amountCents: row.amount_cents })
    pricesByProduct.set(row.product_id, list)
  }

  const applicable: ApplicableProduct[] = products.map((p) => ({
    productId: p.id,
    playProductId: p.play_product_id as string,
    interval: p.interval ?? null,
    prices: pricesByProduct.get(p.id) ?? [],
  }))

  const token = await playAccessToken(JSON.parse(decrypted.credential) as PlayServiceAccountJson)

  // 3. One discount offer per applicable product.
  const offerIdsByProduct: Record<string, string> = {}
  const errors: string[] = []
  for (const prod of applicable) {
    const recurrenceCount = couponPeriodCount(opts.duration, opts.durationInMonths, prod.interval)
    if (recurrenceCount === null) {
      errors.push(`${prod.playProductId}: a ${opts.durationInMonths}-month discount doesn't fit a ${prod.interval} plan`)
      continue
    }
    if (prod.prices.length === 0) { errors.push(`${prod.playProductId}: no prices`); continue }
    const regions = resolveRegions(prod.prices)
    if (regions.length === 0) { errors.push(`${prod.playProductId}: no mappable regions`); continue }

    // region → discounted price (first price per region wins, same collapse as base plan)
    const discountByRegion = new Map<string, { currency: string; cents: number }>()
    for (const { currency, amountCents } of prod.prices) {
      const region = CURRENCY_REGION[currency.toUpperCase()]
      if (!region || discountByRegion.has(region)) continue
      discountByRegion.set(region, {
        currency,
        cents: Math.max(1, Math.round(amountCents * (1 - opts.percentOff / 100))),
      })
    }

    const basePlanId = basePlanIdFor(prod.playProductId)
    const offerId = couponOfferIdFor(basePlanId, opts.code)
    const offersBase =
      `/applications/${pkg}/subscriptions/${encodeURIComponent(prod.playProductId)}` +
      `/basePlans/${encodeURIComponent(basePlanId)}/offers`

    // Idempotent: skip create when the offer already exists (offer phases are immutable once live).
    const getRes = await playFetch(token, `${offersBase}/${encodeURIComponent(offerId)}`)
    if (!getRes.ok && getRes.status === 404) {
      const offerBody = {
        packageName: pkg,
        productId: prod.playProductId,
        basePlanId,
        offerId,
        phases: [
          {
            duration: playBillingPeriod(prod.interval),
            recurrenceCount,
            regionalConfigs: regions.map((regionCode) => ({
              regionCode,
              price: toPlayMoney(
                discountByRegion.get(regionCode)!.currency,
                discountByRegion.get(regionCode)!.cents,
              ),
            })),
          },
        ],
        targeting: { acquisitionRule: { scope: { thisSubscription: {} } } },
        regionalConfigs: regions.map((regionCode) => ({ regionCode, newSubscriberAvailability: true })),
        offerTags: [{ tag: "coupon" }],
      }
      const createRes = await playFetch(
        token,
        `${offersBase}?offerId=${encodeURIComponent(offerId)}&regionsVersion.version=${REGIONS_VERSION}`,
        { method: "POST", body: JSON.stringify(offerBody) },
      )
      if (!createRes.ok) {
        errors.push(`${prod.playProductId}: create ${createRes.status} ${shortPlayError(await createRes.text())}`)
        continue
      }
    } else if (!getRes.ok) {
      errors.push(`${prod.playProductId}: get ${getRes.status}`)
      continue
    }

    // Best-effort activation (blocked until the app is published — non-fatal).
    await playFetch(token, `${offersBase}/${encodeURIComponent(offerId)}:activate`, {
      method: "POST",
      body: JSON.stringify({ packageName: pkg, productId: prod.playProductId, basePlanId, offerId }),
    }).catch(() => {})

    offerIdsByProduct[prod.productId] = offerId
  }

  if (Object.keys(offerIdsByProduct).length > 0) {
    await supabase
      .from("tenant_coupons")
      .update({ googleplay_offer_ids: offerIdsByProduct, updated_at: new Date().toISOString() })
      .eq("id", opts.couponRowId)
  }
  // Some products legitimately can't take the discount (e.g. a deep % puts a
  // region's price below Play's floor) — record as skipped, never fail the sync.
  return { offerIdsByProduct, skipped: errors }
}

export async function syncCouponBestEffort(args: Parameters<typeof syncCouponToGooglePlay>[0]) {
  try {
    await syncCouponToGooglePlay(args)
  } catch (e: any) {
    console.error("[googleplay-coupon-sync] failed:", e?.message ?? e)
  }
}
