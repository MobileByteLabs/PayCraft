import { appStoreConnectToken, type AppStoreConnectCreds } from "./store-jwt"

/**
 * Create / update an App Store Connect subscription (+ subscription group,
 * + price) for a PayCraft product via the App Store Connect API, using a
 * TENANT'S OWN .p8 API key.
 *
 * Endpoints (App Store Connect API v1, base https://api.appstoreconnect.apple.com):
 *   GET  /v1/apps?filter[bundleId]={bundleId}                         (resolve appId)
 *   GET  /v1/apps/{appId}/subscriptionGroups                         (find group)
 *   POST /v1/subscriptionGroups                                      (create group)
 *   GET  /v1/subscriptionGroups/{groupId}/subscriptions             (find by productId)
 *   POST /v1/subscriptions                                           (create)
 *   PATCH /v1/subscriptions/{id}                                     (update name)
 *   GET  /v1/subscriptions/{id}/pricePoints                          (resolve price point)
 *   GET  /v1/subscriptions/{id}/prices                              (existing prices)
 *   POST /v1/subscriptionPrices                                     (set price)
 * Docs: https://developer.apple.com/documentation/appstoreconnectapi/app_store/managing_in-app_purchases_and_subscriptions
 *
 * Idempotent — mirrors stripe-product-sync.ts:
 *   - We resolve the app, ensure the subscription group exists (find-or-create
 *     by referenceName), then look up the subscription by its stable productId
 *     inside the group. Present → PATCH the name. Absent → CREATE. A re-run
 *     always targets the SAME subscription (no duplicates).
 *   - Price setting is best-effort: Apple prices are chosen from a fixed
 *     per-territory price-point ladder (you cannot POST an arbitrary amount),
 *     so we resolve the CLOSEST price point to the desired base price and set
 *     it only when no price is configured yet.
 */

const ASC_BASE = "https://api.appstoreconnect.apple.com"

// Apple ships its own group reference name; PayCraft nests all its
// subscriptions under one group so cross-subscription upgrade/downgrade works.
const PAYCRAFT_GROUP_REFERENCE = "PayCraft Subscriptions"

export interface AppStoreCreds extends AppStoreConnectCreds {
  bundleId: string
}

export interface AppStorePriceInput {
  currency: string // ISO 4217
  amountCents: number // minor units
}

export interface AppStoreSyncResult {
  /** The ASC subscription productId written back to tenant_products.app_store_product_id. */
  appStoreProductId: string
  subscriptionResourceId: string
  created: boolean
}

/** PayCraft billing interval → ASC subscriptionPeriod enum. */
function ascSubscriptionPeriod(interval: string | null | undefined): string {
  switch (interval) {
    case "month": return "ONE_MONTH"
    case "quarter": return "THREE_MONTHS"
    case "semiannual": return "SIX_MONTHS"
    case "year": return "ONE_YEAR"
    default:
      throw new Error(`unsupported subscription interval for App Store: ${String(interval)}`)
  }
}

/** ASC productId: reverse-DNS-ish, alphanumeric + '.'; unique per app. */
function sanitizeAscProductId(bundleId: string, sku: string): string {
  const tail = sku.toLowerCase().replace(/[^a-z0-9]/g, "")
  return `${bundleId}.${tail || "product"}`.slice(0, 100)
}

async function ascFetch(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${ASC_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  })
}

async function jsonOrThrow(res: Response, ctx: string): Promise<any> {
  if (!res.ok) {
    throw new Error(`[appstore-product-sync] ${ctx} failed (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

/** Resolve the ASC app resource id from the tenant's bundle id. */
async function resolveAppId(token: string, bundleId: string): Promise<string> {
  const res = await ascFetch(
    token,
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`,
  )
  const json = await jsonOrThrow(res, `apps.list(${bundleId})`)
  const app = json.data?.[0]
  if (!app?.id) throw new Error(`[appstore-product-sync] no app found for bundleId ${bundleId}`)
  return app.id as string
}

/** Find-or-create the PayCraft subscription group for this app. */
async function ensureSubscriptionGroup(token: string, appId: string): Promise<string> {
  const listRes = await ascFetch(token, `/v1/apps/${appId}/subscriptionGroups?limit=200`)
  const list = await jsonOrThrow(listRes, `subscriptionGroups.list(${appId})`)
  const existing = (list.data ?? []).find(
    (g: any) => g?.attributes?.referenceName === PAYCRAFT_GROUP_REFERENCE,
  )
  if (existing?.id) return existing.id as string

  const createRes = await ascFetch(token, `/v1/subscriptionGroups`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionGroups",
        attributes: { referenceName: PAYCRAFT_GROUP_REFERENCE },
        relationships: { app: { data: { type: "apps", id: appId } } },
      },
    }),
  })
  const created = await jsonOrThrow(createRes, "subscriptionGroups.create")
  return created.data.id as string
}

/** Find a subscription by productId inside a group. */
async function findSubscription(
  token: string,
  groupId: string,
  productId: string,
): Promise<string | null> {
  const res = await ascFetch(
    token,
    `/v1/subscriptionGroups/${groupId}/subscriptions?filter[productId]=${encodeURIComponent(productId)}&limit=1`,
  )
  const json = await jsonOrThrow(res, `subscriptions.find(${productId})`)
  return json.data?.[0]?.id ?? null
}

/**
 * Best-effort price set: resolve the closest available price point to the
 * desired base amount for the USD territory, and create a subscriptionPrice
 * only when none is set yet. Apple does not accept arbitrary amounts.
 */
async function ensurePrice(
  token: string,
  subscriptionId: string,
  prices: AppStorePriceInput[],
): Promise<void> {
  // Only proceed for a USD base (Apple auto-derives the rest of the territory
  // ladder from the base price point). No USD price → skip (operator can set
  // pricing manually in App Store Connect).
  const usd = prices.find((p) => p.currency.toUpperCase() === "USD")
  if (!usd) return

  // Already priced? Don't stomp an existing configured price.
  const existingRes = await ascFetch(
    token,
    `/v1/subscriptions/${subscriptionId}/prices?limit=1`,
  )
  if (existingRes.ok) {
    const existing = await existingRes.json()
    if ((existing.data ?? []).length > 0) return
  }

  // Resolve the closest USD price point (customerPrice is a decimal string).
  const targetUsd = usd.amountCents / 100
  const ppRes = await ascFetch(
    token,
    `/v1/subscriptions/${subscriptionId}/pricePoints?filter[territory]=USA&limit=200`,
  )
  if (!ppRes.ok) {
    console.warn(
      `[appstore-product-sync] pricePoints lookup failed (${ppRes.status}); leaving ${subscriptionId} unpriced for manual setup`,
    )
    return
  }
  const pp = await ppRes.json()
  const points: any[] = pp.data ?? []
  if (points.length === 0) return
  let best = points[0]
  let bestDelta = Number.POSITIVE_INFINITY
  for (const point of points) {
    const price = parseFloat(point?.attributes?.customerPrice ?? "NaN")
    if (!Number.isFinite(price)) continue
    const delta = Math.abs(price - targetUsd)
    if (delta < bestDelta) {
      bestDelta = delta
      best = point
    }
  }

  const priceRes = await ascFetch(token, `/v1/subscriptionPrices`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionPrices",
        attributes: { startDate: null, preserveCurrentPrice: false },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subscriptionId } },
          subscriptionPricePoint: {
            data: { type: "subscriptionPricePoints", id: best.id },
          },
        },
      },
    }),
  })
  if (!priceRes.ok) {
    console.warn(
      `[appstore-product-sync] subscriptionPrices.create failed (${priceRes.status}): ${await priceRes.text()}`,
    )
  }
}

export async function syncProductToAppStore(
  creds: AppStoreCreds,
  paycraftProductId: string, // for logging correlation only
  sku: string,
  productName: string,
  interval: string | null,
  prices: AppStorePriceInput[],
  existingAppStoreProductId?: string,
): Promise<AppStoreSyncResult> {
  const token = appStoreConnectToken(creds)

  const appId = await resolveAppId(token, creds.bundleId)
  const groupId = await ensureSubscriptionGroup(token, appId)

  const productId = existingAppStoreProductId || sanitizeAscProductId(creds.bundleId, sku)

  const existingId = await findSubscription(token, groupId, productId)

  if (existingId) {
    // Present → refresh the reference name only (productId + period are
    // immutable in App Store Connect once created).
    const patchRes = await ascFetch(token, `/v1/subscriptions/${existingId}`, {
      method: "PATCH",
      body: JSON.stringify({
        data: {
          type: "subscriptions",
          id: existingId,
          attributes: { name: productName.slice(0, 64) },
        },
      }),
    })
    if (!patchRes.ok) {
      console.error(
        `[appstore-product-sync] subscription patch failed for ${productId} (${patchRes.status}): ${await patchRes.text()}`,
      )
    }
    await ensurePrice(token, existingId, prices)
    return { appStoreProductId: productId, subscriptionResourceId: existingId, created: false }
  }

  // Not found → CREATE the subscription.
  const createRes = await ascFetch(token, `/v1/subscriptions`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptions",
        attributes: {
          name: productName.slice(0, 64),
          productId,
          subscriptionPeriod: ascSubscriptionPeriod(interval),
          familySharable: false,
          groupLevel: 1,
        },
        relationships: {
          subscriptionGroup: {
            data: { type: "subscriptionGroups", id: groupId },
          },
        },
      },
    }),
  })
  const created = await jsonOrThrow(createRes, `subscriptions.create(${productId})`)
  const newId = created.data.id as string

  await ensurePrice(token, newId, prices)

  return { appStoreProductId: productId, subscriptionResourceId: newId, created: true }
}
