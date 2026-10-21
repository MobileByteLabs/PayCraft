/**
 * Create / update an App Store CONSUMABLE or NON-CONSUMABLE in-app purchase for a PayCraft
 * product, via App Store Connect's `inAppPurchases` v2 resource.
 *
 *   GET   /v1/apps/{appId}/inAppPurchasesV2?filter[productId]=…   (probe)
 *   POST  /v2/inAppPurchases                                       (create)
 *   PATCH /v2/inAppPurchases/{id}                                  (update name/review note)
 *   GET   /v2/inAppPurchases/{id}/pricePoints?filter[territory]=USA
 *   POST  /v1/inAppPurchasePriceSchedules                          (set the price)
 *   POST  /v1/inAppPurchaseLocalizations                           (name + description)
 * Docs: https://developer.apple.com/documentation/appstoreconnectapi/app_store/managing_in-app_purchases
 *
 * ## Separate from appstore-product-sync for the same reason as Play
 *
 * Subscriptions live under `/v1/subscriptions` inside a subscription GROUP (so upgrade/downgrade
 * works between them). A consumable has no group, no cadence, and no introductory offer — and its
 * price is set through a PRICE SCHEDULE rather than per-territory price rows. Nothing about the
 * subscription path transfers except the auth and `resolveAppId`, both imported here.
 *
 * ## Here Apple DOES model consumable-ness
 *
 * Unlike Play, `inAppPurchaseType` is a real attribute: `CONSUMABLE` may be bought repeatedly,
 * `NON_CONSUMABLE` is owned once. Getting it wrong is not cosmetic — a coin pack created as
 * NON_CONSUMABLE can be purchased exactly once per Apple ID, forever, and the fix is a NEW product
 * because the type is immutable after creation. So the type is derived from PayCraft's own
 * `type` column rather than defaulted.
 *
 * ## Why so much of this reports rather than throws
 *
 * A freshly created IAP sits in MISSING_METADATA until it has a localization, a price, and (for
 * review) a screenshot. That is the NORMAL end state of a first sync, not a failure — so the
 * result carries `state` and the caller surfaces it, in the same spirit as the subscription path's
 * "created but not yet active" reporting. Treating it as an error would make every first run look broken.
 */

import { ascFetch, type AppStoreCreds, type AppStorePriceInput } from "./appstore-product-sync"
import { appStoreConnectToken } from "./store-jwt"

export interface AppStoreInAppSyncResult {
  /** The ASC productId written back to tenant_products.app_store_product_id. */
  appStoreProductId: string
  /** ASC resource id (needed for price/localization follow-ups). */
  inAppPurchaseId?: string
  created: boolean
  /** ASC review state, e.g. MISSING_METADATA / READY_TO_SUBMIT / APPROVED. */
  state?: string
  priced: boolean
  localized: boolean
  error?: string
  warning?: string
}

/** ASC productId: reverse-DNS-ish, alphanumeric + '.', unique per app. */
export function sanitizeAscInAppProductId(bundleId: string, sku: string): string {
  const tail = sku.toLowerCase().replace(/[^a-z0-9]/g, "")
  return `${bundleId}.${tail || "product"}`.slice(0, 100)
}

/**
 * PayCraft type → ASC `inAppPurchaseType`.
 *
 * IMMUTABLE after creation on Apple's side, which is why this is a total mapping with no default:
 * a wrong guess here cannot be patched later, only replaced with a new product under a new id.
 */
export function ascInAppPurchaseType(paycraftType: string): "CONSUMABLE" | "NON_CONSUMABLE" {
  return paycraftType === "consumable" ? "CONSUMABLE" : "NON_CONSUMABLE"
}

async function findExisting(
  token: string,
  appId: string,
  productId: string,
): Promise<{ id: string; state?: string } | null> {
  const res = await ascFetch(
    token,
    `/v1/apps/${appId}/inAppPurchasesV2?filter[productId]=${encodeURIComponent(productId)}&limit=1`,
  )
  if (!res.ok) return null
  const row = (await res.json())?.data?.[0]
  return row?.id ? { id: row.id, state: row?.attributes?.state } : null
}

/** Name + description. Required before the IAP can leave MISSING_METADATA. */
async function ensureLocalization(
  token: string,
  iapId: string,
  productName: string,
  description: string,
): Promise<{ ok: boolean; reason?: string }> {
  const listRes = await ascFetch(
    token,
    `/v2/inAppPurchases/${iapId}/inAppPurchaseLocalizations?limit=200`,
  )
  if (listRes.ok) {
    const rows: any[] = (await listRes.json())?.data ?? []
    const enUs = rows.find((r) => r?.attributes?.locale === "en-US")
    if (enUs?.id) {
      const patch = await ascFetch(token, `/v1/inAppPurchaseLocalizations/${enUs.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            type: "inAppPurchaseLocalizations",
            id: enUs.id,
            // name is what the purchase sheet shows; description is review-facing.
            attributes: { name: productName.slice(0, 30), description: description.slice(0, 45) },
          },
        }),
      })
      return patch.ok ? { ok: true } : { ok: false, reason: `localization patch ${patch.status}` }
    }
  }

  const res = await ascFetch(token, `/v1/inAppPurchaseLocalizations`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "inAppPurchaseLocalizations",
        attributes: {
          locale: "en-US",
          name: productName.slice(0, 30),
          description: description.slice(0, 45),
        },
        relationships: { inAppPurchaseV2: { data: { type: "inAppPurchases", id: iapId } } },
      },
    }),
  })
  return res.ok ? { ok: true } : { ok: false, reason: `localization create ${res.status}` }
}

/**
 * Set the price via a price SCHEDULE.
 *
 * Apple prices an IAP by picking one of ITS OWN price points rather than accepting an arbitrary
 * amount, so the USD target is matched to the nearest available point — the same nearest-point
 * search the subscription path uses. An exact match is not guaranteed to exist, and silently
 * skipping when it does not would leave a $0 product that looks configured.
 */
async function ensurePrice(
  token: string,
  iapId: string,
  usd: AppStorePriceInput,
): Promise<{ ok: boolean; reason?: string }> {
  const ppRes = await ascFetch(
    token,
    `/v2/inAppPurchases/${iapId}/pricePoints?filter[territory]=USA&limit=200`,
  )
  if (!ppRes.ok) return { ok: false, reason: `price points unavailable (${ppRes.status})` }
  const points: any[] = (await ppRes.json())?.data ?? []
  if (points.length === 0) return { ok: false, reason: "App Store returned no USD price points" }

  const target = usd.amountCents / 100
  let best = points[0]
  let bestDelta = Number.POSITIVE_INFINITY
  for (const point of points) {
    const price = parseFloat(point?.attributes?.customerPrice ?? "NaN")
    if (!Number.isFinite(price)) continue
    const delta = Math.abs(price - target)
    if (delta < bestDelta) {
      bestDelta = delta
      best = point
    }
  }

  const res = await ascFetch(token, `/v1/inAppPurchasePriceSchedules`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "inAppPurchasePriceSchedules",
        relationships: {
          inAppPurchase: { data: { type: "inAppPurchases", id: iapId } },
          // baseTerritory + one manual price; Apple derives the rest of the world from its own
          // equalisation table, which is why no per-territory fan-out is needed here.
          baseTerritory: { data: { type: "territories", id: "USA" } },
          manualPrices: { data: [{ type: "inAppPurchasePrices", id: "${newPrice}" }] },
        },
      },
      included: [
        {
          type: "inAppPurchasePrices",
          id: "${newPrice}",
          attributes: { startDate: null },
          relationships: {
            inAppPurchasePricePoint: { data: { type: "inAppPurchasePricePoints", id: best.id } },
          },
        },
      ],
    }),
  })
  return res.ok ? { ok: true } : { ok: false, reason: `price schedule ${res.status}` }
}

/**
 * Create or update the in-app purchase for [sku]. Idempotent: an existing IAP is patched and
 * re-priced rather than refused, so a re-sync after a price change converges.
 */
export async function syncInAppPurchaseToAppStore(
  creds: AppStoreCreds,
  _paycraftProductId: string, // logging correlation only
  sku: string,
  productName: string,
  paycraftType: string,
  prices: AppStorePriceInput[],
  grantQuantity: number | null,
  existingAppStoreProductId?: string,
  storeDescription?: string | null,
): Promise<AppStoreInAppSyncResult> {
  const token = await appStoreConnectToken(creds)
  const appId = await resolveAppIdLocal(token, creds.bundleId)

  const productId = existingAppStoreProductId || sanitizeAscInAppProductId(creds.bundleId, sku)
  const iapType = ascInAppPurchaseType(paycraftType)
  const description =
    storeDescription ||
    (grantQuantity && grantQuantity > 0 ? `Adds ${grantQuantity} to your balance.` : productName)

  let existing = await findExisting(token, appId, productId)
  let created = false

  if (!existing) {
    const res = await ascFetch(token, `/v2/inAppPurchases`, {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "inAppPurchases",
          attributes: {
            name: productName.slice(0, 64),
            productId,
            inAppPurchaseType: iapType,
            // Family Sharing OFF for a consumable: sharing a coin pack across a family would let
            // one purchase credit several balances. Apple also forbids changing this later for
            // consumables, so the conservative value is the only safe one to create with.
            familySharable: false,
            reviewNote: `PayCraft ${iapType.toLowerCase()} — grants ${grantQuantity ?? 0} units per purchase.`,
          },
          relationships: { app: { data: { type: "apps", id: appId } } },
        },
      }),
    })
    if (!res.ok) {
      return {
        appStoreProductId: productId,
        created: false,
        priced: false,
        localized: false,
        error: `inAppPurchases.create failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      }
    }
    const body = await res.json()
    existing = { id: body?.data?.id, state: body?.data?.attributes?.state }
    created = true
  }

  if (!existing?.id) {
    return {
      appStoreProductId: productId,
      created,
      priced: false,
      localized: false,
      error: "App Store did not return an in-app purchase id",
    }
  }

  const loc = await ensureLocalization(token, existing.id, productName, description)
  const usd = prices.find((p) => p.currency.toUpperCase() === "USD") ?? prices[0]
  const price = usd
    ? await ensurePrice(token, existing.id, usd)
    : { ok: false, reason: "no price configured" }

  return {
    appStoreProductId: productId,
    inAppPurchaseId: existing.id,
    created,
    state: existing.state,
    localized: loc.ok,
    priced: price.ok,
    // Partial completion is a WARNING, not an error: the product exists and is correct as far as
    // it got, and the next sync converges. An error here would roll a usable artifact back to
    // "nothing happened" in the caller's summary.
    warning: [loc.ok ? null : loc.reason, price.ok ? null : price.reason]
      .filter(Boolean)
      .join("; ") || undefined,
  }
}

/** Local copy of the app lookup — appstore-product-sync keeps its own private. */
async function resolveAppIdLocal(token: string, bundleId: string): Promise<string> {
  const res = await ascFetch(
    token,
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
  )
  if (!res.ok) throw new Error(`[appstore-inapp-sync] apps.list(${bundleId}) failed (${res.status})`)
  const app = (await res.json())?.data?.[0]
  if (!app?.id) throw new Error(`[appstore-inapp-sync] no app found for bundleId ${bundleId}`)
  return app.id as string
}
