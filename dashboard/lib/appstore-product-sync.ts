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
  /**
   * URL of an operator-supplied review screenshot, from `store_config.review_screenshot_url`.
   * Takes precedence over the generated one: a real capture of the shipped app beats a render.
   */
  reviewScreenshotUrl?: string | null
  /**
   * Fallback screenshot rendered from the tenant's own paywall config. The paywall is SERVER
   * DRIVEN, so this is a picture of what the SDK will actually show — and unlike a hand-captured
   * PNG it cannot go stale when a price or headline changes.
   */
  reviewScreenshotPng?: Uint8Array | null
}

export interface AppStorePriceInput {
  currency: string // ISO 4217
  amountCents: number // minor units
}

export interface AppStoreSyncResult {
  /**
   * Why APP-level availability could not be verified or set, when that is the case.
   *
   * Distinct from every other field here, which describes the SUBSCRIPTION. Kept separate precisely
   * because the two were conflated once already: subscription availability was configured on all
   * three products while App Store Connect still showed the app's own availability unset.
   */
  appAvailabilityWarning?: string

  /**
   * Localization outcome — either a failure, or a note that customer-facing copy was DERIVED.
   * Surfaced because these strings appear on the App Store: an auto-generated description that
   * nobody is told about is machine-written copy shipped to customers.
   */
  localizationWarning?: string

  /**
   * Why pricing is incomplete, when it is.
   *
   * This existed as a discarded return value: `await ensurePrice(...)` with the result thrown away,
   * so a subscription priced in 1 of 175 territories reported `status: ok` and read as fully synced.
   * The state that caused it (`MISSING_METADATA`) was then invisible from the dashboard, and the
   * only symptom was a field in App Store Connect that no error message ever mentioned.
   */
  pricingWarning?: string

  /** Why the required App Store review screenshot is still missing, when it is. */
  reviewScreenshotWarning?: string

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
/**
 * Ensure the subscription carries an App Store review screenshot.
 *
 * THE LAST THING HOLDING A SUBSCRIPTION IN `MISSING_METADATA`. Apple requires one screenshot per
 * subscription before it can be submitted — audited on a real app where availability, price,
 * localizations and a free-trial offer were all correct and all three subscriptions were still
 * unsubmittable.
 *
 * THE IMAGE IS THE OPERATOR'S. It is a picture of THEIR paywall, so this never invents one: the
 * source is `store_config.review_screenshot_url`, set on the App Store provider page. With no URL
 * configured this reports what is missing and why, rather than uploading a placeholder that would
 * reach an App Review engineer.
 *
 * Apple's asset flow is three steps and all three must succeed, which is why a partial upload is
 * reported rather than silently left behind:
 *   1. POST   /v1/subscriptionAppStoreReviewScreenshots       reserve — returns uploadOperations
 *   2. PUT    (each uploadOperation.url)                      the bytes, with Apple's own headers
 *   3. PATCH  /v1/subscriptionAppStoreReviewScreenshots/{id}  commit with `uploaded: true`
 *
 * The resource type matters: the generic `appStoreReviewScreenshots` is for app VERSIONS and 404s
 * here with "The path provided does not match a defined resource type." Subscriptions carry their
 * own type, even though the relationship on the subscription is named `appStoreReviewScreenshot`.
 * A reservation that is never committed leaves an asset stuck in `AWAITING_UPLOAD`, which looks to
 * an operator exactly like no screenshot at all.
 */
async function ensureReviewScreenshot(
  token: string,
  subscriptionId: string,
  screenshotUrl: string | null,
  generatedPng: Uint8Array | null,
): Promise<{ ok: boolean; created: boolean; reason?: string }> {
  const rel = await ascFetch(token, `/v1/subscriptions/${subscriptionId}/appStoreReviewScreenshot`)
  if (rel.ok) {
    // A to-one relationship answers 200 with `data: null` when the resource is ABSENT — the status
    // alone proves nothing, which is how an absent asset can read as a present one.
    const body = await rel.json().catch(() => null)
    if (body?.data?.id) return { ok: true, created: false }
  }

  // Operator-supplied URL wins; otherwise the paywall render. Only when there is NEITHER is this a
  // reportable gap — which should now be rare, since the render needs no operator action.
  let bytes: Uint8Array
  let fileName: string
  if (screenshotUrl) {
    const imgRes = await fetch(screenshotUrl)
    if (!imgRes.ok) {
      return { ok: false, created: false, reason: `could not fetch screenshot (${imgRes.status}) from the configured URL` }
    }
    bytes = new Uint8Array(await imgRes.arrayBuffer())
    fileName = (screenshotUrl.split("/").pop() || "review.png").split("?")[0]
  } else if (generatedPng && generatedPng.byteLength > 0) {
    bytes = generatedPng
    fileName = "paywall-review.png"
  } else {
    return {
      ok: false,
      created: false,
      reason:
        "no review screenshot available — App Store requires one per subscription before it can " +
        "leave MISSING_METADATA. Add a screenshot URL on the App Store provider page, or ensure " +
        "the paywall has at least one active product so one can be rendered",
    }
  }

  const reserveRes = await ascFetch(token, `/v1/subscriptionAppStoreReviewScreenshots`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionAppStoreReviewScreenshots",
        attributes: { fileSize: bytes.byteLength, fileName },
        relationships: { subscription: { data: { type: "subscriptions", id: subscriptionId } } },
      },
    }),
  })
  if (!reserveRes.ok) {
    const body = await reserveRes.text()
    return { ok: false, created: false, reason: `reserve failed (${reserveRes.status}${ascErrorDetail(body)})` }
  }
  const reserved = await reserveRes.json()
  const assetId: string = reserved?.data?.id
  const ops: Array<{ url: string; method: string; requestHeaders?: Array<{ name: string; value: string }>; offset: number; length: number }> =
    reserved?.data?.attributes?.uploadOperations ?? []
  if (!assetId || ops.length === 0) {
    return { ok: false, created: false, reason: "App Store returned no upload operations for the screenshot" }
  }

  for (const op of ops) {
    const headers: Record<string, string> = {}
    for (const h of op.requestHeaders ?? []) headers[h.name] = h.value
    const chunk = bytes.slice(op.offset, op.offset + op.length)
    const put = await fetch(op.url, { method: op.method ?? "PUT", headers, body: chunk })
    if (!put.ok) {
      return { ok: false, created: false, reason: `screenshot upload failed (${put.status}) — asset ${assetId} left uncommitted` }
    }
  }

  // `sourceFileChecksum` is deliberately OMITTED. Apple expects an MD5 there, and WebCrypto — the
  // only digest available on this edge runtime — does not implement MD5. Sending a SHA-256 in a
  // field documented as MD5 would fail validation while looking like a checksum was provided, which
  // is worse than omitting an optional field: the upload itself is already verified by the PUT.
  const commitRes = await ascFetch(token, `/v1/subscriptionAppStoreReviewScreenshots/${assetId}`, {
    method: "PATCH",
    body: JSON.stringify({
      data: {
        type: "subscriptionAppStoreReviewScreenshots",
        id: assetId,
        attributes: { uploaded: true },
      },
    }),
  })
  if (!commitRes.ok) {
    const body = await commitRes.text()
    return { ok: false, created: false, reason: `screenshot commit failed (${commitRes.status}${ascErrorDetail(body)})` }
  }
  return { ok: true, created: true }
}

/**
 * Ensure the subscription GROUP and the subscription itself carry an App Store localization.
 *
 * WITHOUT THESE, NOTHING ELSE MATTERS. Apple holds a subscription in `MISSING_METADATA` until it has
 * a localized display name and description, and a group without a localization blocks every
 * subscription inside it. Audited on a real app: availability, price and a free-trial offer were all
 * configured correctly on three subscriptions that still could not be submitted, because this sync
 * had never written a single localization — it created products that were complete in every respect
 * except the one that lets them be sold.
 *
 * COPY IS DERIVED ONLY WHEN NOTHING IS AUTHORED, and the caller is told when that happened. These
 * strings appear on the App Store, so inventing them silently would ship machine-written copy to
 * customers. The derivation is deliberately plain — the product's own name plus its billing cadence
 * — and exists so an operator is never BLOCKED on submission by a field they did not know about.
 *
 * Apple's limits are hard: name ≤ 30 characters, description ≤ 45. Exceeding either is a 409, so
 * both are truncated rather than passed through.
 */
const ASC_NAME_MAX = 30
const ASC_DESCRIPTION_MAX = 45
const ASC_DEFAULT_LOCALE = "en-US"

function ascCadenceWords(interval: string | null): string {
  switch ((interval ?? "").toLowerCase()) {
    case "year":
      return "Billed yearly"
    case "semiannual":
      return "Billed every 6 months"
    case "quarter":
      return "Billed quarterly"
    default:
      return "Billed monthly"
  }
}

/** The app's own name, which is what a subscription GROUP should be called. Best-effort. */
async function groupAppName(token: string, groupId: string): Promise<string | undefined> {
  const res = await ascFetch(token, `/v1/subscriptionGroups/${groupId}/app?fields[apps]=name`)
  if (!res.ok) return undefined
  return (await res.json())?.data?.attributes?.name || undefined
}

/** "Cappy Plus (Annual)" → "Cappy Plus". Used only as a fallback when the app name is unreadable. */
function stripPlanQualifier(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim() || name
}

/**
 * Ensure the subscription group has a customer-facing localized name.
 *
 * The group name is shown to customers above the individual plans in Manage Subscriptions, so it
 * must name the product FAMILY. It was previously set from `productName` — whichever plan happened
 * to sync first — which left this group publicly called "Cappy Plus (Annual)" even though it also
 * contains the monthly and guardian plans. Order of iteration is not a naming decision.
 *
 * An existing localization is left alone unless it carries that exact defect signature: a name
 * matching one of the group's OWN subscription names. Anything else is assumed deliberate and is
 * never overwritten — repairing a bug must not stomp an operator's chosen wording.
 */
async function ensureSubscriptionGroupLocalization(
  token: string,
  groupId: string,
  fallbackName: string,
): Promise<{ ok: boolean; created: boolean; reason?: string }> {
  const listRes = await ascFetch(
    token,
    `/v1/subscriptionGroups/${groupId}/subscriptionGroupLocalizations?limit=50`,
  )

  if (listRes.ok) {
    const existing = (await listRes.json())?.data ?? []
    if (existing.length > 0) {
      const row = existing[0]
      const current: string = row?.attributes?.name ?? ""
      // Cheap local test first: the defect always leaves a trailing plan qualifier, so a healthy
      // group costs no extra API calls at all.
      if (!/\([^)]*\)\s*$/.test(current)) return { ok: true, created: false }

      const subsRes = await ascFetch(token, `/v1/subscriptionGroups/${groupId}/subscriptions?limit=50`)
      if (!subsRes.ok) return { ok: true, created: false }
      const subNames: string[] = ((await subsRes.json())?.data ?? [])
        .map((s: any) => s?.attributes?.name)
        .filter(Boolean)
      if (!subNames.includes(current)) return { ok: true, created: false }

      const desired = (await groupAppName(token, groupId)) || stripPlanQualifier(current)
      if (!desired || desired === current) return { ok: true, created: false }

      const patch = await ascFetch(token, `/v1/subscriptionGroupLocalizations/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          data: {
            type: "subscriptionGroupLocalizations",
            id: row.id,
            attributes: { name: desired.slice(0, ASC_NAME_MAX) },
          },
        }),
      })
      if (patch.ok) return { ok: true, created: false }
      const body = await patch.text()
      return { ok: false, created: false, reason: `group rename ${patch.status}${ascErrorDetail(body)}` }
    }
  }

  const desired = (await groupAppName(token, groupId)) || stripPlanQualifier(fallbackName)
  const res = await ascFetch(token, `/v1/subscriptionGroupLocalizations`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionGroupLocalizations",
        attributes: { name: desired.slice(0, ASC_NAME_MAX), locale: ASC_DEFAULT_LOCALE },
        relationships: { subscriptionGroup: { data: { type: "subscriptionGroups", id: groupId } } },
      },
    }),
  })
  if (res.ok) return { ok: true, created: true }
  const body = await res.text()
  console.warn(`[appstore-product-sync] groupLocalization failed for ${groupId} (${res.status}): ${body}`)
  return { ok: false, created: false, reason: `${res.status}${ascErrorDetail(body)}` }
}

async function ensureSubscriptionLocalization(
  token: string,
  subscriptionId: string,
  displayName: string,
  interval: string | null,
  /** Operator-authored copy. Absent → derive, and SAY it was derived. */
  storeDescription?: string | null,
): Promise<{ ok: boolean; created: boolean; derivedDescription: boolean; reason?: string }> {
  const listRes = await ascFetch(
    token,
    `/v1/subscriptions/${subscriptionId}/subscriptionLocalizations?limit=50`,
  )
  if (listRes.ok) {
    const existing = (await listRes.json())?.data ?? []
    // Any existing localization is left alone: an operator who wrote store copy in App Store Connect
    // must not have it overwritten by a product sync.
    if (existing.length > 0) return { ok: true, created: false, derivedDescription: false }
  }

  const name = displayName.slice(0, ASC_NAME_MAX)
  // Operator copy wins. The derived string stays as the fallback — and `derivedDescription` is only
  // true in that case, so the "a machine wrote your store copy" warning stops firing once a human
  // has written it.
  const authored = (storeDescription ?? "").trim()
  const derivedDescription = authored.length === 0
  const description = (derivedDescription
    ? `${displayName} — ${ascCadenceWords(interval)}`
    : authored
  ).slice(0, ASC_DESCRIPTION_MAX)

  const res = await ascFetch(token, `/v1/subscriptionLocalizations`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionLocalizations",
        attributes: { name, description, locale: ASC_DEFAULT_LOCALE },
        relationships: { subscription: { data: { type: "subscriptions", id: subscriptionId } } },
      },
    }),
  })
  if (res.ok) return { ok: true, created: true, derivedDescription }
  const body = await res.text()
  console.warn(
    `[appstore-product-sync] subscriptionLocalization failed for ${subscriptionId} (${res.status}): ${body}`,
  )
  return { ok: false, created: false, derivedDescription: false, reason: `${res.status}${ascErrorDetail(body)}` }
}

/**
 * Ensure the APP itself is available in the App Store's territories.
 *
 * NOT the same thing as `ensureSubscriptionAvailability`, and the distinction costs real time when
 * it is missed: subscription availability decides where a SUBSCRIPTION may be sold, app availability
 * decides where the APP may be downloaded. They are separate ASC resources, and setting one says
 * nothing about the other — cappy had subscription availability on all three products (175
 * territories) while App Store Connect still showed a bare "Set Up Availability" button for the app.
 *
 * Verified on a real app: `/v1/apps/{id}` answered 200 while
 * `/v1/apps/{id}/appAvailabilityV2` answered 404 — the relationship resolves, the resource does not
 * exist. That 404 is the "not set up" signal; a 200 with a data id means it is already configured
 * and this leaves it completely alone (where an app ships is not something a product sync should
 * quietly re-decide).
 *
 * PERMISSION IS THE LIKELY FAILURE. An ASC key scoped for in-app purchases can manage subscriptions
 * but not app-level distribution; the collection read `/v2/appAvailabilities` answered 403
 * FORBIDDEN_ERROR with the same key that syncs subscriptions happily. So this reports rather than
 * throws: a sync that can configure subscriptions must not fail wholesale because it cannot set app
 * distribution, and the operator needs to be told WHICH of the two it was.
 */
async function ensureAppAvailability(
  token: string,
  appId: string,
): Promise<{ ok: boolean; alreadySet?: boolean; reason?: string }> {
  const existing = await ascFetch(token, `/v1/apps/${appId}/appAvailabilityV2`)
  if (existing.ok) {
    const body = await existing.json().catch(() => null)
    if (body?.data?.id) return { ok: true, alreadySet: true }
  } else if (existing.status !== 404) {
    // 403 here means the key cannot even look; saying so beats reporting "not set up".
    const body = await existing.text()
    return {
      ok: false,
      reason:
        `cannot read app availability (${existing.status}${ascErrorDetail(body)}) — an ASC key with ` +
        `Admin or App Manager access is required to manage where the APP ships; subscription ` +
        `availability is unaffected`,
    }
  }

  const terrRes = await ascFetch(token, `/v1/territories?limit=200`)
  if (!terrRes.ok) return { ok: false, reason: `could not list territories (${terrRes.status})` }
  const territories: string[] = ((await terrRes.json())?.data ?? [])
    .map((x: { id?: unknown }) => x?.id)
    .filter((id: unknown): id is string => typeof id === "string")
  if (territories.length === 0) return { ok: false, reason: "App Store returned no territories" }

  // v2 is JSON:API "included"-shaped, unlike the subscription endpoint.
  //
  // Referencing the territories from `relationships` alone is not enough — Apple answers
  // `409 ENTITY_ERROR.RELATIONSHIP.INVALID: expects an included resource with type
  // 'territoryAvailabilities' and id 'AFG' but no matching resource was included`. Each territory
  // must appear TWICE: once as a relationship reference and once as a fully-formed
  // `territoryAvailabilities` resource in `included`, carrying `available` and its own link to the
  // territory. The id of that resource is the territory code itself.
  const res = await ascFetch(token, `/v2/appAvailabilities`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "appAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          app: { data: { type: "apps", id: appId } },
          territoryAvailabilities: {
            // LOCAL ids, not territory codes. These resources do not exist yet, so Apple requires
            // the JSON:API inline-creation form: `ENTITY_ERROR.INCLUDED.INVALID_ID: the id must be
            // a local id with the format '\${local-id}'`. The real territory is named by the
            // `territory` relationship on each included resource, below.
            data: territories.map((id) => ({ type: "territoryAvailabilities", id: `\${${id}}` })),
          },
        },
      },
      included: territories.map((id) => ({
        type: "territoryAvailabilities",
        id: `\${${id}}`,
        attributes: { available: true },
        relationships: { territory: { data: { type: "territories", id } } },
      })),
    }),
  })
  if (res.ok) return { ok: true, alreadySet: false }

  const body = await res.text()
  console.warn(`[appstore-product-sync] appAvailabilities.create failed for ${appId} (${res.status}): ${body}`)
  return {
    ok: false,
    reason:
      `${res.status}${ascErrorDetail(body)}` +
      (res.status === 403
        ? " — this ASC key cannot manage app distribution; use an Admin/App Manager key, or set it once under Pricing and Availability"
        : ""),
  }
}

/**
 * Ensure the subscription is AVAILABLE in the App Store's territories.
 *
 * WHY THIS HAS TO HAPPEN FIRST
 * App Store Connect refuses almost everything else until availability exists. Creating a free-trial
 * introductory offer against a subscription with no availability answers
 * `409 STATE_ERROR: You need to set up availabilities first.` — which is exactly what cappy hit, and
 * which read as "the app is not live" only because the liveness guidance was appended to it. The two
 * are unrelated: availability is a property of the SUBSCRIPTION, and a TestFlight/in-review app can
 * have it set perfectly well.
 *
 * Nothing in this sync ever called this endpoint, so every subscription it created was left in a
 * state where prices and offers could not attach — the subscription existed and could never be sold.
 *
 * ALL territories, with `availableInNewTerritories`. PayCraft prices in 30+ currencies and the
 * paywall is served worldwide, so restricting availability here would silently contradict the
 * catalogue. `availableInNewTerritories: true` also means a storefront Apple adds later is included
 * rather than quietly missing.
 *
 * Idempotent: an existing availability is left alone (Apple treats it as immutable-ish, and
 * re-POSTing conflicts).
 */
async function ensureSubscriptionAvailability(
  token: string,
  subscriptionId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const existing = await ascFetch(
    token,
    `/v1/subscriptions/${subscriptionId}/subscriptionAvailability`,
  )
  if (existing.ok) {
    const body = await existing.json().catch(() => null)
    if (body?.data?.id) return { ok: true }
  }

  const terrRes = await ascFetch(token, `/v1/territories?limit=200`)
  if (!terrRes.ok) {
    return { ok: false, reason: `could not list territories (${terrRes.status})` }
  }
  const territories: string[] = ((await terrRes.json())?.data ?? [])
    .map((x: { id?: unknown }) => x?.id)
    .filter((id: unknown): id is string => typeof id === "string")
  if (territories.length === 0) return { ok: false, reason: "App Store returned no territories" }

  const res = await ascFetch(token, `/v1/subscriptionAvailabilities`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionAvailabilities",
        attributes: { availableInNewTerritories: true },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subscriptionId } },
          availableTerritories: {
            data: territories.map((id) => ({ type: "territories", id })),
          },
        },
      },
    }),
  })
  if (res.ok) return { ok: true }

  const body = await res.text()
  console.warn(
    `[appstore-product-sync] subscriptionAvailabilities.create failed for ${subscriptionId} (${res.status}): ${body}`,
  )
  return { ok: false, reason: `${res.status}${ascErrorDetail(body)}` }
}

/**
 * Pull Apple's own explanation out of an App Store Connect error body.
 *
 * ASC answers with `{"errors":[{"status","code","title","detail"}]}`. `detail` is written for a
 * human and is the only part worth showing; `code` is included because it is what Apple's docs and
 * support threads are indexed by. Returns "" when the body is not the expected shape, so a caller
 * can always interpolate it without a conditional.
 */
function ascErrorDetail(body: string): string {
  try {
    const first = JSON.parse(body)?.errors?.[0]
    if (!first) return ""
    const code = typeof first.code === "string" ? first.code : null
    const detail = typeof first.detail === "string" ? first.detail : (first.title ?? null)
    if (!code && !detail) return ""
    return ` — ${[code, detail].filter(Boolean).join(": ")}`
  } catch {
    return ""
  }
}

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
    // CARRY APPLE'S REASON, not just the status. A bare "USA (409)" tells an operator that
    // something conflicted and nothing about what — and 409 covers several very different causes
    // (the offer already exists, the subscription is missing metadata or price points, a required
    // relationship is absent). The body was already being logged to a console nobody reads while
    // the actionable half was dropped from the message that actually reaches the dashboard.
    failures.push(`${territory} (${createRes.status}${ascErrorDetail(body)})`)
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
 * Price the subscription in EVERY territory it is available in.
 *
 * WHY COVERAGE AND NOT EXISTENCE
 * This function used to create one USD price and stop, on the assumption — written into its own
 * comment — that "Apple auto-derives the rest of the territory ladder from the base price point".
 * That is true of the App Store Connect UI, which equalizes for you as you type. It is NOT true of
 * the API: a price POST creates exactly one row, for exactly one territory.
 *
 * The result was a subscription available in 175 territories and priced in 1, which App Store
 * Connect reports as `MISSING_METADATA` — with no indication of WHICH metadata, and no error from
 * any call, because every individual request succeeded. Worse, the old early-return ("any price
 * exists → done") meant no amount of re-syncing could ever repair it: the single USA row it had
 * just created was proof to the next run that pricing was complete.
 *
 * So the check is coverage: the set of territories the subscription is SOLD in, minus the set it is
 * PRICED in, must be empty. Apple's own `equalizations` endpoint supplies the per-territory price
 * point for a chosen base, so the prices match what the UI would have produced.
 */
/**
 * Price creations attempted per sync run. Sized for a paid Cloudflare Worker (1000 subrequests);
 * on the free tier (50) the run truncates and the next one resumes, per the note in ensurePrice.
 */
const MAX_PRICE_CREATES_PER_RUN = 200

async function ensurePrice(
  token: string,
  subscriptionId: string,
  prices: AppStorePriceInput[],
): Promise<{ ok: boolean; reason?: string }> {
  const usd = prices.find((p) => p.currency.toUpperCase() === "USD")
  // Not a failure: no USD base means the operator prices manually in App Store Connect.
  if (!usd) return { ok: true, reason: "no USD base price — left for manual pricing" }

  const territoriesOf = (rows: any[]): string[] =>
    rows.map((r) => r?.relationships?.territory?.data?.id).filter(Boolean)

  // Where is it SOLD? Read from the availability rather than assuming the app's own territories:
  // a subscription can legitimately be narrower than its app.
  let soldIn: string[] = []
  const availRes = await ascFetch(token, `/v1/subscriptions/${subscriptionId}/subscriptionAvailability`)
  if (availRes.ok) {
    const availId = (await availRes.json())?.data?.id
    if (availId) {
      const tRes = await ascFetch(
        token,
        `/v1/subscriptionAvailabilities/${availId}/availableTerritories?limit=200`,
      )
      if (tRes.ok) soldIn = ((await tRes.json())?.data ?? []).map((t: any) => t.id).filter(Boolean)
    }
  }

  // Where is it PRICED? Also the source of the existing base point, so a re-run reuses the operator's
  // chosen price rather than re-deriving (and possibly changing) it.
  let existingRows: any[] = []
  const existingRes = await ascFetch(token, `/v1/subscriptions/${subscriptionId}/prices?limit=200`)
  if (existingRes.ok) existingRows = (await existingRes.json())?.data ?? []
  const pricedIn = new Set(territoriesOf(existingRows))

  // Fully covered already — including the ordinary case of a re-sync with nothing to do.
  if (soldIn.length > 0 && soldIn.every((t) => pricedIn.has(t))) return { ok: true }

  // Establish the base price point: whatever USA already uses, else the closest point to the
  // configured amount. Everything else is equalized FROM this, so it is chosen once and only once.
  let basePointId: string | undefined = existingRows.find(
    (r) => r?.relationships?.territory?.data?.id === "USA",
  )?.relationships?.subscriptionPricePoint?.data?.id

  if (!basePointId) {
    const targetUsd = usd.amountCents / 100
    const ppRes = await ascFetch(
      token,
      `/v1/subscriptions/${subscriptionId}/pricePoints?filter[territory]=USA&limit=200`,
    )
    if (!ppRes.ok) return { ok: false, reason: `price points unavailable (${ppRes.status})` }
    const points: any[] = (await ppRes.json())?.data ?? []
    if (points.length === 0) return { ok: false, reason: "App Store returned no USD price points" }
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
    basePointId = best.id
    const created = await createPrice(token, subscriptionId, basePointId!)
    if (!created.ok) return created
    pricedIn.add("USA")
  }

  // No availability readable → the base price is the best that can be justified. Reported, not
  // silently treated as success, because it is exactly the state that reads as complete and is not.
  if (soldIn.length === 0) {
    return { ok: false, reason: "availability territories unreadable — priced base territory only" }
  }

  const eqRes = await ascFetch(
    token,
    // `include=territory` is REQUIRED: without it the rows come back with no relationships, the
    // territory map builds empty, and every territory is silently classified "no equalized price
    // point" — 0 created, 0 failures, and a sync that looks like it merely had nothing to do.
    `/v1/subscriptionPricePoints/${basePointId}/equalizations?include=territory&limit=200`,
  )
  if (!eqRes.ok) {
    return { ok: false, reason: `equalizations unavailable (${eqRes.status})` }
  }
  const eqRows: any[] = (await eqRes.json())?.data ?? []
  const pointByTerritory = new Map<string, string>()
  for (const row of eqRows) {
    const terr = row?.relationships?.territory?.data?.id
    if (terr && row.id) pointByTerritory.set(terr, row.id)
  }

  const allMissing = soldIn.filter((t) => !pricedIn.has(t))
  // Subrequest budget. Cloudflare's free tier caps ONE request at 50 subrequests and the enclosing
  // route already splits by provider to stay under it; ~174 price creations would blow straight
  // through. Capping keeps a sync from dying mid-way with an opaque platform error.
  //
  // This is safe to truncate precisely BECAUSE the check above is coverage-based: the next run
  // recomputes `soldIn - pricedIn` and continues from where this one stopped, so repeated syncs
  // converge. The partial is reported as NOT ok, so an operator is never told pricing is complete
  // while territories remain unpriced.
  const missing = allMissing.slice(0, MAX_PRICE_CREATES_PER_RUN)
  const deferred = allMissing.length - missing.length
  const unpriceable: string[] = []
  const failures: string[] = []
  let created = 0

  // Bounded concurrency: ~174 calls per subscription, and a serial loop makes a routine sync crawl
  // while an unbounded fan-out trips App Store Connect's rate limiting.
  const CONCURRENCY = 10
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    await Promise.all(
      missing.slice(i, i + CONCURRENCY).map(async (terr) => {
        const pointId = pointByTerritory.get(terr)
        if (!pointId) {
          unpriceable.push(terr)
          return
        }
        const res = await createPrice(token, subscriptionId, pointId)
        if (res.ok) created++
        else if (failures.length < 3) failures.push(`${terr}: ${res.reason}`)
      }),
    )
  }

  if (failures.length > 0) {
    return {
      ok: false,
      reason: `priced ${created}/${missing.length} territories; first failures — ${failures.join("; ")}`,
    }
  }
  if (deferred > 0) {
    return {
      ok: false,
      reason: `priced ${created} territories; ${deferred} remaining — re-run sync to continue`,
    }
  }
  if (unpriceable.length > 0) {
    // Apple offers no equalized point for these, so they cannot be priced from this base.
    return {
      ok: true,
      reason: `priced ${created} territories; ${unpriceable.length} without an equalized price point (${unpriceable.slice(0, 5).join(", ")})`,
    }
  }
  return { ok: true }
}

/** Create one subscriptionPrice row for one territory's price point. */
async function createPrice(
  token: string,
  subscriptionId: string,
  pricePointId: string,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await ascFetch(token, `/v1/subscriptionPrices`, {
    method: "POST",
    body: JSON.stringify({
      data: {
        type: "subscriptionPrices",
        attributes: { startDate: null, preserveCurrentPrice: false },
        relationships: {
          subscription: { data: { type: "subscriptions", id: subscriptionId } },
          subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: pricePointId } },
        },
      },
    }),
  })
  if (res.ok) return { ok: true }
  const body = await res.text()
  console.warn(`[appstore-product-sync] subscriptionPrices.create failed (${res.status}): ${body}`)
  return { ok: false, reason: `${res.status}${ascErrorDetail(body)}` }
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
  /** Operator-authored store listing description; derived from name + cadence when absent. */
  storeDescription?: string | null,
): Promise<AppStoreSyncResult> {
  const token = await appStoreConnectToken(creds)
  const wantsTrial = typeof trialDays === "number" && trialDays > 0

  // Universal-purchase apps share ONE App Store Connect app (one bundle id, one
  // set of subscription groups) across iOS + macOS + tvOS binaries. The single
  // subscription + introductory offer synced here therefore already applies to the
  // Mac build automatically — there is no separate macOS bundle id, subscription
  // group, or sync path to provision. Do NOT add a macos branch or second bundle.
  const appId = await resolveAppId(token, creds.bundleId)

  // VERIFY (and set, when permitted) where the APP itself ships — checked here rather than assumed,
  // because a subscription with perfect availability still cannot be sold in a territory the app
  // does not reach. Idempotent and never fatal: an already-configured app is left untouched, and a
  // key without app-distribution rights degrades to a reported reason rather than failing a sync
  // that otherwise succeeded.
  const appAvailability = await ensureAppAvailability(token, appId)
  let localizationWarning: string | undefined
  const groupId = await ensureSubscriptionGroup(token, appId)
  // A group with no localization blocks every subscription inside it, whatever else is configured.
  const groupLoc = await ensureSubscriptionGroupLocalization(token, groupId, productName)
  if (!groupLoc.ok) localizationWarning = `subscription group localization not set: ${groupLoc.reason}`

  const productId = existingAppStoreProductId || sanitizeAscProductId(creds.bundleId, sku)

  const existingId = await findSubscription(token, groupId, productId)

  // Provision the FREE_TRIAL introductory offer once the subscription exists,
  // in BOTH branches, so re-syncing an existing subscription can add a trial.
  const withTrial = async (raw: AppStoreSyncResult): Promise<AppStoreSyncResult> => {
    // Attach the app-availability verdict to every result shape below, so it cannot be dropped by
    // whichever branch happens to return.
    // The localization is what lifts a subscription out of MISSING_METADATA, so it runs for every
    // product on every sync — after the subscription exists, before any verdict is formed.
    const loc = await ensureSubscriptionLocalization(
      token, raw.subscriptionResourceId, productName, interval, storeDescription,
    )
    if (!loc.ok) {
      localizationWarning = `subscription localization not set: ${loc.reason}`
    } else if (loc.created && loc.derivedDescription) {
      localizationWarning =
        `App Store description was auto-generated from the product name — review it in App Store ` +
        `Connect before submitting, it is customer-facing copy`
    }

    const shot = await ensureReviewScreenshot(
      token,
      raw.subscriptionResourceId,
      creds.reviewScreenshotUrl ?? null,
      creds.reviewScreenshotPng ?? null,
    )

    const base: AppStoreSyncResult = {
      ...raw,
      ...(shot.ok ? {} : { reviewScreenshotWarning: shot.reason }),
      ...(appAvailability.ok ? {} : { appAvailabilityWarning: `app availability not set: ${appAvailability.reason}` }),
      ...(localizationWarning ? { localizationWarning } : {}),
    }
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
    // BEFORE prices: Apple answers 409 STATE_ERROR "You need to set up availabilities first" for
    // both price and offer writes on a subscription that has none.
    await ensureSubscriptionAvailability(token, existingId)
    const priceOutcome = await ensurePrice(token, existingId, prices)
    return withTrial({
      appStoreProductId: productId,
      subscriptionResourceId: existingId,
      created: false,
      ...(localizationWarning ? { localizationWarning } : {}),
      ...(priceOutcome.ok && !priceOutcome.reason
        ? {}
        : { pricingWarning: priceOutcome.reason ?? "pricing incomplete" }),
    })
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

  // A newly created subscription has no availability at all, which is why every subscription this
  // sync has ever created was left unable to take a price or an offer.
  await ensureSubscriptionAvailability(token, newId)
  const newPriceOutcome = await ensurePrice(token, newId, prices)

  return withTrial({
    appStoreProductId: productId,
    subscriptionResourceId: newId,
    created: true,
    ...(localizationWarning ? { localizationWarning } : {}),
    ...(newPriceOutcome.ok && !newPriceOutcome.reason
      ? {}
      : { pricingWarning: newPriceOutcome.reason ?? "pricing incomplete" }),
  })
}
