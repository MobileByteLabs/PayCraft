import { ascFetch, resolveAscSubscriptionId } from "@/lib/appstore-product-sync"
import { appStoreConnectToken } from "@/lib/store-jwt"
import type { AppStoreConnectCreds } from "@/lib/store-jwt"

/**
 * Report whether each App Store subscription is actually SELLABLE, by reading App Store Connect.
 *
 * WHY THIS EXISTS
 * Every layer of this system used to answer "is the product synced?" by checking whether a local
 * identifier had been filled in — `tenant_products.app_store_product_id is not null`. That is a
 * record of a past API call, not a statement about the store. On 2026-09-17 all three cappy
 * subscriptions had their ids, reported `unsynced_count: 0`, showed `status: ok` on every re-sync,
 * and were sitting in `MISSING_METADATA` — unsellable, unsubmittable, and invisible as a problem.
 *
 * The specific cause was price coverage (available in 175 territories, priced in 1), but the CLASS
 * is what matters: a completeness question answered with an existence check. So this module asks
 * App Store Connect for `state`, and when that state is not sellable it enumerates the concrete
 * reasons rather than reporting an opaque failure — the thing `MISSING_METADATA` itself never does.
 */

/** States in which a subscription is done as far as metadata is concerned. */
const SELLABLE_STATES = new Set([
  "READY_TO_SUBMIT",
  "WAITING_FOR_REVIEW",
  "IN_REVIEW",
  "APPROVED",
  "DEVELOPER_REMOVED_FROM_SALE",
  "REMOVED_FROM_SALE",
])

export interface SubscriptionReadiness {
  /** tenant_products.id — so a caller can re-sync exactly this product without a second lookup. */
  id: string
  sku: string
  productId: string | null
  /** Raw App Store Connect state, or null when the subscription could not be located. */
  state: string | null
  ready: boolean
  /** Concrete, actionable gaps — empty when ready. */
  blockers: string[]
  /** Populated even when ready, for display. */
  pricedTerritories?: number
  soldTerritories?: number
}

async function readJson(token: string, path: string): Promise<any | null> {
  const res = await ascFetch(token, path)
  if (!res.ok) return null
  return res.json().catch(() => null)
}

/**
 * Enumerate why a subscription is not sellable. Each probe is independent so one unreadable
 * resource never masks the others — a partial answer is more useful than a single failure.
 */
async function diagnose(token: string, subscriptionId: string): Promise<{
  blockers: string[]
  priced?: number
  sold?: number
}> {
  const blockers: string[] = []

  const avail = await readJson(token, `/v1/subscriptions/${subscriptionId}/subscriptionAvailability`)
  const availId = avail?.data?.id
  let sold: number | undefined
  if (!availId) {
    blockers.push("no availability configured")
  } else {
    const terr = await readJson(
      token,
      `/v1/subscriptionAvailabilities/${availId}/availableTerritories?limit=200`,
    )
    sold = terr?.meta?.paging?.total
    if (!sold) blockers.push("available in no territories")
  }

  const prices = await readJson(token, `/v1/subscriptions/${subscriptionId}/prices?limit=200`)
  const priced: number | undefined = prices?.meta?.paging?.total
  if (!priced) {
    blockers.push("no price set")
  } else if (typeof sold === "number" && priced < sold) {
    // The exact shape of the 2026-09-17 incident, named precisely so nobody has to rediscover it.
    blockers.push(`priced in ${priced} of ${sold} territories`)
  }

  const locs = await readJson(
    token,
    `/v1/subscriptions/${subscriptionId}/subscriptionLocalizations?limit=50`,
  )
  const locRows: any[] = locs?.data ?? []
  if (locRows.length === 0) blockers.push("no localization (display name + description)")
  else if (!locRows.some((l) => l?.attributes?.name && l?.attributes?.description)) {
    blockers.push("localization missing a name or description")
  }

  const shot = await readJson(token, `/v1/subscriptions/${subscriptionId}/appStoreReviewScreenshot`)
  const shotState = shot?.data?.attributes?.assetDeliveryState?.state
  if (!shot?.data) blockers.push("no review screenshot")
  else if (shotState !== "COMPLETE") blockers.push(`review screenshot ${shotState ?? "incomplete"}`)

  return { blockers, priced, sold }
}

export async function appStoreSubscriptionReadiness(
  creds: AppStoreConnectCreds & { bundleId: string },
  products: Array<{ id: string; sku: string; appStoreProductId: string | null }>,
): Promise<SubscriptionReadiness[]> {
  const token = await appStoreConnectToken(creds)
  const out: SubscriptionReadiness[] = []

  for (const p of products) {
    if (!p.appStoreProductId) {
      out.push({ id: p.id, sku: p.sku, productId: null, state: null, ready: false, blockers: ["not synced to App Store"] })
      continue
    }

    let subscriptionId = await resolveAscSubscriptionId(token, creds.bundleId, p.appStoreProductId)

    if (!subscriptionId) {
      // `resolveAscSubscriptionId` swallows every error and returns null, so "absent" and "the API
      // was unreachable" arrive identically. Reporting a transient 429 as "your product does not
      // exist" is a false blocker that would halt a deploy and send someone hunting a product that
      // is sitting right there — observed twice on consecutive calls during this work.
      //
      // Retry once (transients usually clear), then ask a question whose answer separates the two:
      // can we reach the app at all? If yes, a null resolve really does mean absent.
      subscriptionId = await resolveAscSubscriptionId(token, creds.bundleId, p.appStoreProductId)
    }

    if (!subscriptionId) {
      const appProbe = await ascFetch(token, `/v1/apps?filter[bundleId]=${encodeURIComponent(creds.bundleId)}&limit=1`)
      const reachable = appProbe.ok
      out.push({
        id: p.id,
        sku: p.sku,
        productId: p.appStoreProductId,
        state: null,
        ready: false,
        blockers: [
          reachable
            ? // App Store answered about the app and still has no such subscription — a local id
              // pointing at nothing is exactly the false-green this module exists to catch.
              "product id recorded locally but no such subscription in App Store Connect"
            : // Not evidence about the product. Still not ready (we could not confirm it sells),
              // but the reason must say what is actually known.
              `could not verify with App Store Connect (HTTP ${appProbe.status}) — this is not evidence the product is missing; re-run when the API is reachable`,
        ],
      })
      continue
    }

    const subRes = await readJson(token, `/v1/subscriptions/${subscriptionId}`)
    const state: string | null = subRes?.data?.attributes?.state ?? null
    const ready = state != null && SELLABLE_STATES.has(state)

    if (ready) {
      out.push({ id: p.id, sku: p.sku, productId: p.appStoreProductId, state, ready: true, blockers: [] })
      continue
    }

    const { blockers, priced, sold } = await diagnose(token, subscriptionId)
    out.push({
      id: p.id,
      sku: p.sku,
      productId: p.appStoreProductId,
      state,
      ready: false,
      // Never report "not ready" with an empty explanation: if every probe came back clean the
      // honest answer is that the cause is unknown, not that there is no cause.
      blockers:
        blockers.length > 0
          ? blockers
          : [`App Store reports ${state ?? "an unknown state"}; no missing artifact identified`],
      pricedTerritories: priced,
      soldTerritories: sold,
    })
  }

  return out
}
