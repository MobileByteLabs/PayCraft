/**
 * Create / update a Google Play ONE-TIME PRODUCT for a PayCraft consumable or one_time product,
 * via the Play Developer API v3 `monetization.onetimeproducts` resource.
 *
 *   GET   /applications/{packageName}/oneTimeProducts/{productId}   (probe)
 *   PATCH /applications/{packageName}/onetimeproducts/{productId}   (upsert)
 * Docs: https://developers.google.com/android-publisher/api-ref/rest/v3/monetization.onetimeproducts
 *
 * ## This module used to call `inappproducts`, and production rejected it
 *
 * The first version of this file used the legacy `inappproducts` resource (POST to create, PUT to
 * update, `priceMicros` strings). Every sync failed with:
 *
 *   inappproducts.get failed (403): Please migrate to the new publishing API.
 *
 * — a PERMISSION_DENIED that is not about permissions. Google has retired the legacy in-app
 * products API, and `monetization.onetimeproducts` replaces it. Confirmed against the live
 * discovery document (`$discovery/rest?version=v3`) rather than inferred: `inappproducts` is still
 * LISTED there with all its methods, so its presence in the API surface proves nothing about
 * whether a call will be served.
 *
 * ## Two things about this resource that will bite
 *
 * 1. **The path casing is inconsistent in Google's own API.** `get`/`list` are served at
 *    `/oneTimeProducts` (camelCase) while `patch` is at `/onetimeproducts` (all lowercase). A GET
 *    against the lowercase spelling returns an HTML 404 — not a JSON API error — so it reads like
 *    the resource does not exist rather than like a typo. Both spellings below are deliberate;
 *    normalising them to one will break whichever call you normalise away from.
 * 2. **There is no `insert`.** Creation is `patch` + `allowMissing=true`, which makes this
 *    naturally idempotent: the same call creates or converges a product. `updateMask` and
 *    `regionsVersion.version` are both REQUIRED on every patch.
 *
 * ## Why this is a separate module from googleplay-product-sync
 *
 * One-time products and subscriptions are different RESOURCES, not two shapes of one call: they
 * differ in endpoint, in body, and in how availability is expressed (a base plan is activated by
 * its own endpoint; a purchase option's `state` is OUTPUT-ONLY and follows from availability plus
 * app publication). The subscription path stays untouched and this sits beside it.
 *
 * Price encoding, however, is now SHARED. The legacy resource wanted `priceMicros` (minor units ×
 * 10,000, as a string); `monetization.*` wants a `Money` of `{currencyCode, units, nanos}`, which
 * is exactly what the subscription path's `toPlayMoney` already produces — including the
 * zero-decimal handling. So the local `toPriceMicros` helper this module used to export is gone
 * rather than ported: a second money converter is a second place for an exponent slip, and the
 * surviving one is the one with a live-tested caller.
 *
 * ## Consumable vs one-time, and why Play does not care here
 *
 * Whether a purchase is CONSUMED (re-buyable, e.g. a coin pack) or kept forever (a lifetime
 * unlock) is decided by the CLIENT at finish time — `consumeAsync` vs `acknowledgePurchase` —
 * which the SDK already picks from `BillingPlan.isConsumable`. Both PayCraft types therefore map
 * to the same Play artifact, and "consumable" is not expressed in this body at all. Looking for a
 * consumable flag here is a category error.
 */

import {
  type GooglePlayCreds,
  type GooglePlayPriceInput,
  CURRENCY_REGION,
  REGIONS_VERSION,
  playFetch,
  shortPlayError,
  toPlayMoney,
} from "./googleplay-product-sync"
import { playAccessToken, type PlayServiceAccountJson } from "./store-jwt"

export interface GooglePlayInAppSyncResult {
  /** The Play one-time-product id written back to tenant_products.play_product_id. */
  playProductId: string
  created: boolean
  /** True when the product is purchasable after this sync. */
  active: boolean
  error?: string
  warning?: string
}

/** Play listing caps: title ≤ 55, description ≤ 80. Over-length is a 400, not a truncation. */
const TITLE_MAX = 55
const DESCRIPTION_MAX = 80

/**
 * The single purchase option every PayCraft pack gets.
 *
 * Deterministic and immutable, like the product id: a second option id on a re-sync would ADD an
 * option rather than converge the existing one, leaving two ways to buy the same pack at whatever
 * prices each was last written with.
 */
const BUY_OPTION_ID = "buy"

/** One-time product ids: lowercase alphanumeric, `_` and `.`, must start with a letter or digit. */
export function sanitizeInAppProductId(sku: string): string {
  const id = sku.toLowerCase().replace(/[^a-z0-9._]/g, "_").replace(/^[._]+|[._]+$/g, "")
  return (id || "product").slice(0, 40).replace(/[._]+$/g, "") || "product"
}

/** `listings` is an ARRAY on this resource (it was a language-keyed object on `inappproducts`). */
export function oneTimeListings(
  productName: string,
  grantQuantity: number | null,
  storeDescription?: string | null,
) {
  // A pack's description should say what it GRANTS — that is the entire product. Falling back to
  // the name alone would ship "550 Ripples / 550 Ripples", which tells a buyer nothing they did
  // not already see on the button.
  const fallback = grantQuantity && grantQuantity > 0
    ? `Adds ${grantQuantity} to your balance instantly.`
    : productName
  return [{
    languageCode: "en-US",
    title: productName.slice(0, TITLE_MAX),
    description: (storeDescription || fallback).slice(0, DESCRIPTION_MAX),
  }]
}

/**
 * PayCraft prices (by CURRENCY) → Play `regionalPricingAndAvailabilityConfigs` (by REGION).
 *
 * The mapping is the shared `CURRENCY_REGION` collapse the subscription path uses (many currencies
 * → one region, first price for a region wins), so a pack and a plan can never end up sold in
 * different places. Matching a currency code against a region code directly would silently price
 * almost nothing — "USD" is not "US".
 */
export function regionalConfigsFor(prices: GooglePlayPriceInput[]) {
  const seen = new Set<string>()
  const out: Array<{ regionCode: string; price: ReturnType<typeof toPlayMoney>; availability: string }> = []
  for (const { currency, amountCents } of prices) {
    const region = CURRENCY_REGION[currency.toUpperCase()]
    if (!region || seen.has(region)) continue
    seen.add(region)
    out.push({
      regionCode: region,
      price: toPlayMoney(currency, amountCents),
      availability: "AVAILABLE",
    })
  }
  return out
}

/**
 * Create or converge the one-time product for [sku]. Idempotent by construction — `patch` with
 * `allowMissing` is both the create and the update.
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
  const regionalConfigs = regionalConfigsFor(prices)
  if (regionalConfigs.length === 0) {
    // Not "no prices" — no price whose currency maps to a Play region. Saying which matters: a
    // product priced only in a currency CURRENCY_REGION does not know looks identically unpriced.
    return {
      playProductId: productId,
      created: false,
      active: false,
      error: prices.length === 0
        ? "no price configured"
        : `no price currency maps to a Play region (${prices.map((p) => p.currency).join(", ")})`,
    }
  }

  // camelCase on purpose — see (1) in the header. This probe only decides created-vs-updated for
  // the result; the patch below is an upsert either way, so a probe failure must not abort it.
  const probe = await playFetch(token, `/applications/${pkg}/oneTimeProducts/${encodeURIComponent(productId)}`)
  const existed = probe.ok

  const body = {
    packageName: pkg,
    productId,
    listings: oneTimeListings(productName, grantQuantity, storeDescription),
    purchaseOptions: [{
      purchaseOptionId: BUY_OPTION_ID,
      // `legacyCompatible` is the field that decides whether EXISTING Play Billing flows can see
      // this product at all. Purchase options are a newer PBL concept; a client querying the way
      // most shipped apps do gets nothing back for a product with no legacy-compatible option, so
      // the pack would exist in Play Console, report synced here, and be invisible in the app.
      // Exactly one option per product may carry it, which is why there is exactly one.
      buyOption: { legacyCompatible: true },
      regionalPricingAndAvailabilityConfigs: regionalConfigs,
      // Price for regions Play launches in later. Without it a new market inherits no price and
      // the product silently stops being purchasable there. USD and EUR are both required.
      newRegionsConfig: {
        availability: "AVAILABLE",
        usdPrice: priceIn(prices, "USD") ?? toPlayMoney("USD", fallbackCents(prices)),
        eurPrice: priceIn(prices, "EUR") ?? toPlayMoney("EUR", fallbackCents(prices)),
      },
    }],
    // NOTE: `purchaseOptions[].state` is OUTPUT-ONLY on this resource. There is nothing to set to
    // make a pack live — it follows from availability plus a published app, which is why a freshly
    // created product reports not-yet-purchasable rather than active.
  }

  // updateMask + regionsVersion.version are REQUIRED; allowMissing makes patch do the create.
  const res = await playFetch(
    token,
    `/applications/${pkg}/onetimeproducts/${encodeURIComponent(productId)}` +
      `?updateMask=listings,purchaseOptions&allowMissing=true&regionsVersion.version=${REGIONS_VERSION}`,
    { method: "PATCH", body: JSON.stringify(body) },
  )
  if (!res.ok) {
    return {
      playProductId: productId,
      created: false,
      active: false,
      error: `onetimeproducts.patch failed (${res.status}): ${shortPlayError(await res.text())}`,
    }
  }

  const saved = await res.json()
  const state: string | undefined = saved?.purchaseOptions?.[0]?.state
  const active = state === "ACTIVE"
  return {
    playProductId: productId,
    created: !existed,
    active,
    // Report the state verbatim rather than calling a DRAFT product synced-and-done. Play keeps a
    // one-time product in DRAFT until the app has a published release that can sell it.
    warning: active
      ? undefined
      : `written to Play, but the one-time product is ${state ?? "not yet ACTIVE"} — it becomes purchasable once a release containing it is published`,
  }
}

/** The Money for [currency] if PayCraft priced it explicitly, else null. */
function priceIn(prices: GooglePlayPriceInput[], currency: string) {
  const row = prices.find((p) => p.currency.toUpperCase() === currency)
  return row ? toPlayMoney(currency, row.amountCents) : null
}

/**
 * Minor units to use for a new-region currency PayCraft did not price.
 *
 * The first configured price, NOT a converted one: this module has no FX rate and inventing one is
 * how `/config`'s fallback produced a 100× JPY price. An approximate same-number price in a new
 * market is wrong by a margin a human can spot and fix; a derived one is wrong by 100×.
 */
function fallbackCents(prices: GooglePlayPriceInput[]): number {
  return prices[0]?.amountCents ?? 0
}
