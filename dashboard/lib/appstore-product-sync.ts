import { appStoreConnectToken, type AppStoreConnectCreds } from "./store-jwt"
import { checkAppStoreAppLive } from "@/lib/store-liveness"

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
  /**
   * Whether a FREE_TRIAL introductory offer is present on the subscription after
   * this sync (created here or already existed). false with no trial requested.
   * Without it StoreKit never grants the trial the paywall advertises.
   */
  introductoryOfferActive?: boolean
  /** Human-readable reason the intro offer isn't active (present iff a trial was requested but not set). */
  introductoryOfferError?: string
  /**
   * Set when the trial IS live but does not cover every priced territory. Not an error —
   * customers in the covered storefronts get the trial — but the gap must stay visible,
   * because the paywall advertises the trial everywhere.
   */
  introductoryOfferWarning?: string
  /**
   * Tri-state verdict from the PUBLIC App Store listing, resolved only when something
   * about this sync is not purchasable. `true` = no public listing (the app is unpublished,
   * so the subscription cannot go live); `false` = the app IS live, so publishing is not the
   * blocker; `undefined` = not probed or unreachable — never infer "unpublished" from it.
   */
  appNotPublished?: boolean
  /** Public App Store lookup URL, so the operator can see exactly what we saw. */
  storeListingUrl?: string
  /**
   * Whether a previously-existing FREE_TRIAL introductory offer was REMOVED (or was
   * already absent) on a DISABLE-trial sync. Set only in the no-trial branch — the
   * mirror of introductoryOfferActive. Without this cleanup a stale intro offer
   * lingers on the store and StoreKit keeps granting a trial the paywall no longer
   * advertises.
   */
  introductoryOfferRemoved?: boolean
}

/**
 * App Store introductory-offer durations are a FIXED enum, not arbitrary days.
 * When the requested trial length is EXACTLY one of Apple's allowed durations we
 * map it 1:1 (3 → THREE_DAYS, 7 → ONE_WEEK, 14 → TWO_WEEKS, 30 → ONE_MONTH,
 * 60 → TWO_MONTHS, 90 → THREE_MONTHS, 180 → SIX_MONTHS, 365 → ONE_YEAR) so a
 * standard trial round-trips with zero drift; only an off-ladder value snaps to
 * the NEAREST allowed duration (Apple rejects anything else).
 */
function ascIntroDuration(days: number): string {
  const table: Array<[number, string]> = [
    [3, "THREE_DAYS"], [7, "ONE_WEEK"], [14, "TWO_WEEKS"], [30, "ONE_MONTH"],
    [60, "TWO_MONTHS"], [90, "THREE_MONTHS"], [180, "SIX_MONTHS"], [365, "ONE_YEAR"],
  ]
  // Exact match wins — map 1:1, no snapping.
  const exact = table.find((row) => row[0] === days)
  if (exact) return exact[1]
  // No exact match → snap to the nearest allowed duration (fallback).
  let best = table[0]
  let bestDelta = Number.POSITIVE_INFINITY
  for (const row of table) {
    const delta = Math.abs(row[0] - days)
    if (delta < bestDelta) { bestDelta = delta; best = row }
  }
  return best[1]
}

/**
 * Resolve every territory the subscription is actually priced in.
 *
 * Apple derives the full territory ladder from the USA base price point, so a priced
 * subscription is sellable in ~175 territories — and an introductory offer is
 * PER-TERRITORY. Enumerating them is what keeps the free trial from being USA-only.
 * Falls back to ["USA"] when the ladder cannot be read, which preserves the previous
 * behaviour rather than dropping the trial entirely.
 */
async function resolveOfferTerritories(
  token: string,
  subscriptionId: string,
): Promise<string[]> {
  const res = await ascFetch(
    token,
    `/v1/subscriptions/${subscriptionId}/prices?include=territory&limit=200`,
  )
  if (!res.ok) {
    console.warn(
      `[appstore-product-sync] price-territory lookup failed (${res.status}); scoping the free trial to USA`,
    )
    return ["USA"]
  }
  const body = await res.json()
  const ids = new Set<string>()
  // The territory may arrive either as an `included` resource or as a relationship id.
  for (const inc of body?.included ?? []) {
    if (inc?.type === "territories" && typeof inc?.id === "string") ids.add(inc.id)
  }
  for (const row of body?.data ?? []) {
    const id = row?.relationships?.territory?.data?.id
    if (typeof id === "string") ids.add(id)
  }
  return ids.size > 0 ? [...ids] : ["USA"]
}

/**
 * Ensure a FREE_TRIAL introductory offer exists on the subscription so StoreKit
 * actually grants the trial the paywall advertises. Idempotent: lists existing
 * introductory offers first and creates only the territories still missing one
 * (offers are effectively immutable once live).
 *
 * Apple REQUIRES a `territory` relationship (409 ENTITY_ERROR.RELATIONSHIP.REQUIRED
 * without it) and an introductory offer covers exactly ONE territory, so a trial that
 * should reach every customer needs one offer per priced territory. This previously
 * created a single USA offer, which silently made the advertised free trial
 * USA-only — every other storefront showed the paywall's "14 days free" and then
 * charged immediately. `subscriptionPricePoint` stays omitted: a FREE_TRIAL has no price.
 *
 * Best-effort and never throws. Full coverage → active. Partial coverage → active with a
 * `warning` (the trial works for most customers; the gap must still be visible). No
 * coverage at all → a hard `error`.
 */
async function ensureIntroductoryOffer(
  token: string,
  subscriptionId: string,
  trialDays: number,
): Promise<{ active: boolean; error?: string; warning?: string }> {
  const territories = await resolveOfferTerritories(token, subscriptionId)

  // Probe — which territories ALREADY carry a FREE_TRIAL? (idempotent re-sync)
  const covered = new Set<string>()
  const listRes = await ascFetch(
    token,
    `/v1/subscriptions/${subscriptionId}/introductoryOffers?include=territory&limit=200`,
  )
  if (listRes.ok) {
    const list = await listRes.json()
    for (const o of list.data ?? []) {
      if (o?.attributes?.offerMode !== "FREE_TRIAL") continue
      const t = o?.relationships?.territory?.data?.id
      // An offer with no readable territory means we cannot tell WHICH storefront it
      // covers; treat the whole set as satisfied rather than duplicating offers, which
      // Apple rejects and which would be worse than an incomplete rollout.
      if (typeof t !== "string") return { active: true }
      covered.add(t)
    }
  }

  const missing = territories.filter((t) => !covered.has(t))
  if (missing.length === 0) return { active: true }

  const failures: string[] = []
  let created = 0
  for (const territory of missing) {
    const createRes = await ascFetch(token, `/v1/subscriptionIntroductoryOffers`, {
      method: "POST",
      body: JSON.stringify({
        data: {
          type: "subscriptionIntroductoryOffers",
          attributes: {
            offerMode: "FREE_TRIAL",
            duration: ascIntroDuration(trialDays),
            numberOfPeriods: 1,
            // null start = the always-on baseline intro offer for new subscribers.
            startDate: null,
          },
          relationships: {
            subscription: { data: { type: "subscriptions", id: subscriptionId } },
            territory: { data: { type: "territories", id: territory } },
          },
        },
      }),
    })
    if (createRes.ok) {
      created++
      continue
    }
    const body = await createRes.text()
    console.warn(
      `[appstore-product-sync] introductoryOffers.create failed for ${subscriptionId} in ${territory} (${createRes.status}): ${body}`,
    )
    failures.push(`${territory} (${createRes.status})`)
  }

  const totalCovered = covered.size + created
  if (totalCovered === 0) {
    return {
      active: false,
      error: `free-trial introductory offer not set in any territory: ${failures.slice(0, 5).join(", ")}`,
    }
  }
  if (failures.length > 0) {
    return {
      active: true,
      warning:
        `free-trial introductory offer set in ${totalCovered}/${territories.length} territories; ` +
        `not set in ${failures.length} (${failures.slice(0, 5).join(", ")}${failures.length > 5 ? ", …" : ""})`,
    }
  }
  return { active: true }
}

/**
 * Ensure NO FREE_TRIAL introductory offer lingers on the subscription when the
 * product's trial is turned OFF. The mirror of [ensureIntroductoryOffer]: lists
 * the subscription's introductory offers and DELETEs any FREE_TRIAL one via
 * DELETE /v1/subscriptionIntroductoryOffers/{id}. (Unlike Play base-plan offers,
 * ASC introductory offers have no reversible deactivate — delete is the only
 * teardown, and a re-enable simply re-creates it.) Idempotent: no FREE_TRIAL
 * present → no-op. Best-effort: never throws; returns a reason string on failure
 * so a cleanup problem warns rather than aborting the whole product sync.
 */
async function ensureNoIntroductoryOffer(
  token: string,
  subscriptionId: string,
): Promise<{ removed: boolean; error?: string }> {
  const listRes = await ascFetch(
    token,
    `/v1/subscriptions/${subscriptionId}/introductoryOffers?limit=10`,
  )
  if (!listRes.ok) {
    const err = `introductoryOffers.list failed (${listRes.status}): ${(await listRes.text()).slice(0, 200)}`
    console.warn(`[appstore-product-sync] free-trial cleanup: ${err}`)
    return { removed: false, error: err }
  }
  const list = await listRes.json()
  const freeTrials = (list.data ?? []).filter(
    (o: any) => o?.attributes?.offerMode === "FREE_TRIAL" && o?.id,
  )
  if (freeTrials.length === 0) return { removed: false } // nothing to clean up

  let removedAny = false
  let firstErr: string | undefined
  for (const offer of freeTrials) {
    const delRes = await ascFetch(
      token,
      `/v1/subscriptionIntroductoryOffers/${offer.id}`,
      { method: "DELETE" },
    )
    if (delRes.ok || delRes.status === 404) {
      removedAny = true
      continue
    }
    const err = `introductoryOffers.delete failed for ${offer.id} (${delRes.status}): ${(await delRes.text()).slice(0, 200)}`
    console.warn(`[appstore-product-sync] free-trial cleanup: ${err}`)
    if (!firstErr) firstErr = err
  }
  return { removed: removedAny, error: firstErr }
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

export async function ascFetch(
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
 * Resolve the ASC subscription RESOURCE id (opaque, e.g. "6443…") from the
 * stored product REFERENCE id (e.g. "com.app.promonthly"). The ASC API paths
 * (pricePoints, introductoryOffers) key off the resource id, not the reference
 * — a coupon/offer sync MUST resolve it first or every call 404s. Returns null
 * when the app / group / subscription can't be found (best-effort callers skip).
 */
export async function resolveAscSubscriptionId(
  token: string,
  bundleId: string,
  productId: string,
): Promise<string | null> {
  try {
    const appId = await resolveAppId(token, bundleId)
    const groupId = await ensureSubscriptionGroup(token, appId)
    return await findSubscription(token, groupId, productId)
  } catch {
    return null
  }
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
  /** Free-trial length in days (trial_enabled + trial_duration_days). 0/undefined → no intro offer. */
  trialDays?: number | null,
): Promise<AppStoreSyncResult> {
  const token = await appStoreConnectToken(creds)
  const wantsTrial = typeof trialDays === "number" && trialDays > 0

  // Universal-purchase apps share ONE App Store Connect app (one bundle id, one
  // set of subscription groups) across iOS + macOS + tvOS binaries. The single
  // subscription + introductory offer synced here therefore already applies to the
  // Mac build automatically — there is no separate macOS bundle id, subscription
  // group, or sync path to provision. Do NOT add a macos branch or second bundle.
  const appId = await resolveAppId(token, creds.bundleId)
  const groupId = await ensureSubscriptionGroup(token, appId)

  const productId = existingAppStoreProductId || sanitizeAscProductId(creds.bundleId, sku)

  const existingId = await findSubscription(token, groupId, productId)

  // Provision the FREE_TRIAL introductory offer once the subscription exists,
  // in BOTH branches, so re-syncing an existing subscription can add a trial.
  const withTrial = async (base: AppStoreSyncResult): Promise<AppStoreSyncResult> => {
    if (!wantsTrial) {
      // Trial DISABLED → delete any stale FREE_TRIAL intro offer so StoreKit stops
      // granting a trial the paywall no longer advertises.
      const r = await ensureNoIntroductoryOffer(token, base.subscriptionResourceId)
      return { ...base, introductoryOfferActive: false, introductoryOfferRemoved: r.removed, introductoryOfferError: r.error }
    }
    const t = await ensureIntroductoryOffer(token, base.subscriptionResourceId, trialDays as number)
    const withOffer: AppStoreSyncResult = {
      ...base,
      introductoryOfferActive: t.active,
      introductoryOfferError: t.error,
      introductoryOfferWarning: t.warning,
    }
    if (t.active) return withOffer
    // The offer could not be set anywhere. Apple holds subscriptions and their offers
    // until the APP itself is live, so ask the public storefront and turn the opaque
    // failure into the operator's actual next action.
    const liveness = await checkAppStoreAppLive(creds.bundleId)
    if (liveness.status === "not-published") {
      return {
        ...withOffer,
        appNotPublished: true,
        storeListingUrl: liveness.url,
        introductoryOfferError: `${t.error} — ${liveness.message}`,
      }
    }
    return {
      ...withOffer,
      appNotPublished: liveness.status === "live" ? false : undefined,
      storeListingUrl: liveness.url,
    }
  }

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
    return withTrial({ appStoreProductId: productId, subscriptionResourceId: existingId, created: false })
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
          // ASC keys this relationship `group` (linking a `subscriptionGroups`
          // resource) — NOT `subscriptionGroup`. The wrong key produced a 409
          // ENTITY_ERROR.RELATIONSHIP.UNKNOWN + a missing-required `group` error.
          group: {
            data: { type: "subscriptionGroups", id: groupId },
          },
        },
      },
    }),
  })
  const created = await jsonOrThrow(createRes, `subscriptions.create(${productId})`)
  const newId = created.data.id as string

  await ensurePrice(token, newId, prices)

  return withTrial({ appStoreProductId: productId, subscriptionResourceId: newId, created: true })
}
