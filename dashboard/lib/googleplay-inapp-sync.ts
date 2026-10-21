/**
 * Create / update a Google Play MANAGED PRODUCT (in-app product) for a PayCraft
 * consumable or one-time product, via the Play Developer API v3 `inappproducts`
 * resource.
 *
 *   GET  /applications/{packageName}/inappproducts/{sku}   (probe)
 *   POST /applications/{packageName}/inappproducts         (create)
 *   PUT  /applications/{packageName}/inappproducts/{sku}   (update)
 * Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/inappproducts
 *
 * ## Why this is a separate module from googleplay-product-sync
 *
 * Managed products and subscriptions are different RESOURCES on the Play API, not two shapes of
 * one call. They differ in endpoint, in body, and in price encoding: a subscription base plan
 * carries `regionalConfigs[].price` as a Money `{ currencyCode, units, nanos }`, while a managed
 * product carries `prices[region]` as `{ priceMicros, currency }` — a STRING of micro-units. Trying
 * to serve both from one function would mean branching every field, so the subscription path stays
 * untouched and this sits beside it.
 *
 * ## Consumable vs one-time, and why Play does not care here
 *
 * Play has one managed-product type (`purchaseType: "managedUser"`). Whether a purchase is
 * CONSUMED (re-buyable, e.g. a coin pack) or kept forever (a lifetime unlock) is decided by the
 * CLIENT at finish time — `consumeAsync` vs `acknowledgePurchase` — which the SDK already picks
 * from `BillingPlan.isConsumable`. So both PayCraft types map to the same Play artifact, and the
 * consumable behaviour is not expressed here. Writing a `purchaseType` of anything else, or
 * expecting Play to model "consumable", is a category error.
 *
 * ## Price encoding is the easy thing to get wrong
 *
 * `priceMicros` is minor-units × 10,000 — $4.99 (499 cents) is "4990000". Getting the exponent
 * wrong by one is a 10× mispricing that the API accepts happily, so the conversion lives in one
 * tested helper rather than inline at the call sites.
 */

import {
  type GooglePlayCreds,
  type GooglePlayPriceInput,
  CURRENCY_REGION,
  playFetch,
  shortPlayError,
} from "./googleplay-product-sync"
import { ZERO_DECIMAL_CURRENCIES } from "./pricing-template-data"
import { playAccessToken, type PlayServiceAccountJson } from "./store-jwt"

export interface GooglePlayInAppSyncResult {
  /** The Play managed-product id written back to tenant_products.play_product_id. */
  playProductId: string
  created: boolean
  /** True when the product is `active` (purchasable) after this sync. */
  active: boolean
  error?: string
  warning?: string
}

/** Play listing caps: title ≤ 55, description ≤ 80. Over-length is a 400, not a truncation. */
const TITLE_MAX = 55
const DESCRIPTION_MAX = 80

/**
 * Minor units → Play `priceMicros` (a STRING of micro-units).
 *
 * 499 cents → "4990000". Zero-decimal currencies (JPY, KRW …) have no minor unit, so the amount
 * IS the major unit and scales by 1,000,000 instead of 10,000 — treating ¥500 as 5.00 would
 * under-charge by 100×.
 */
export function toPriceMicros(currency: string, amountCents: number): string {
  const scale = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1_000_000 : 10_000
  return String(Math.round(amountCents * scale))
}

/** Managed-product ids: lowercase alphanumeric, `_` and `.`, must start with a letter or digit. */
export function sanitizeInAppProductId(sku: string): string {
  const id = sku.toLowerCase().replace(/[^a-z0-9._]/g, "_").replace(/^[._]+|[._]+$/g, "")
  return (id || "product").slice(0, 40).replace(/[._]+$/g, "") || "product"
}

function listing(productName: string, grantQuantity: number | null, storeDescription?: string | null) {
  const title = productName.slice(0, TITLE_MAX)
  // A pack's description should say what it GRANTS — that is the entire product. Falling back to
  // the name alone would ship "550 Ripples / 550 Ripples", which tells a buyer nothing they did
  // not already see on the button.
  const fallback = grantQuantity && grantQuantity > 0
    ? `Adds ${grantQuantity} to your balance instantly.`
    : productName
  return {
    "en-US": {
      title,
      description: (storeDescription || fallback).slice(0, DESCRIPTION_MAX),
    },
  }
}

function pricesByRegion(prices: GooglePlayPriceInput[]) {
  // Play keys regional prices by REGION; PayCraft carries them by CURRENCY. The mapping is the
  // shared CURRENCY_REGION collapse the subscription path uses (many currencies → one region,
  // first price for a region wins), so a pack and a plan can never end up sold in different
  // places. Matching a currency code against a region code directly would silently price almost
  // nothing — "USD" is not "US".
  const out: Record<string, { priceMicros: string; currency: string }> = {}
  for (const { currency, amountCents } of prices) {
    const region = CURRENCY_REGION[currency.toUpperCase()]
    if (!region || out[region]) continue
    out[region] = {
      priceMicros: toPriceMicros(currency, amountCents),
      currency: currency.toUpperCase(),
    }
  }
  return out
}

/**
 * Create or update the managed product for [sku]. Idempotent: an existing product is PUT with the
 * current listing and prices rather than refused, so a re-sync after a price change converges.
 */
export async function syncInAppProductToGooglePlay(
  creds: GooglePlayCreds,
  _paycraftProductId: string, // logging correlation only
  sku: string,
  productName: string,
  prices: GooglePlayPriceInput[],
  grantQuantity: number | null,
  existingPlayProductId?: string,
  storeDescription?: string | null,
): Promise<GooglePlayInAppSyncResult> {
  const sa = JSON.parse(creds.serviceAccountJson) as PlayServiceAccountJson
  const token = await playAccessToken(sa)
  const pkg = creds.packageName
  if (!pkg) throw new Error("googleplay-inapp-sync: missing package_name in tenant store config")

  const productId = existingPlayProductId || sanitizeInAppProductId(sku)
  const defaultPrice = prices[0]
  if (!defaultPrice) {
    return { playProductId: productId, created: false, active: false, error: "no price configured" }
  }

  const body = {
    packageName: pkg,
    sku: productId,
    status: "active",
    purchaseType: "managedUser",
    defaultLanguage: "en-US",
    defaultPrice: {
      priceMicros: toPriceMicros(defaultPrice.currency, defaultPrice.amountCents),
      currency: defaultPrice.currency.toUpperCase(),
    },
    prices: pricesByRegion(prices),
    listings: listing(productName, grantQuantity, storeDescription),
  }

  const probe = await playFetch(token, `/applications/${pkg}/inappproducts/${encodeURIComponent(productId)}`)

  if (probe.status === 404) {
    // autoConvertMissingPrices fills regions we did not price explicitly, so a pack is purchasable
    // everywhere the app ships rather than only in the currencies the operator happened to list.
    const res = await playFetch(
      token,
      `/applications/${pkg}/inappproducts?autoConvertMissingPrices=true`,
      { method: "POST", body: JSON.stringify(body) },
    )
    if (!res.ok) {
      return {
        playProductId: productId,
        created: false,
        active: false,
        error: `inappproducts.insert failed (${res.status}): ${shortPlayError(await res.text())}`,
      }
    }
    const created = await res.json()
    return { playProductId: productId, created: true, active: created?.status === "active" }
  }

  if (!probe.ok) {
    return {
      playProductId: productId,
      created: false,
      active: false,
      error: `inappproducts.get failed (${probe.status}): ${shortPlayError(await probe.text())}`,
    }
  }

  const res = await playFetch(
    token,
    `/applications/${pkg}/inappproducts/${encodeURIComponent(productId)}?autoConvertMissingPrices=true`,
    { method: "PUT", body: JSON.stringify(body) },
  )
  if (!res.ok) {
    return {
      playProductId: productId,
      created: false,
      active: false,
      error: `inappproducts.update failed (${res.status}): ${shortPlayError(await res.text())}`,
    }
  }
  const updated = await res.json()
  return { playProductId: productId, created: false, active: updated?.status === "active" }
}
