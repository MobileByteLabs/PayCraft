/**
 * Public store-liveness probes — "is this app actually LIVE on the store?"
 *
 * WHY THIS EXISTS
 * ---------------
 * Both stores refuse to make a product purchasable until the APP is published:
 *
 *   • Google Play rejects `basePlans:activate` with 400 FAILED_PRECONDITION
 *     "The app is not published." — so the base plan stays DRAFT and the SDK's
 *     `queryProductDetails` returns nothing. On device that surfaces as the
 *     maximally-unhelpful "Product not found".
 *   • App Store Connect will hold a subscription in "Waiting for Review" /
 *     "Missing Metadata" until the app itself ships.
 *
 * The provider error alone cannot distinguish "the app is in draft on the console,
 * publish it" from "your credentials are wrong" or "the package name is a typo" —
 * all three arrive as an opaque 400. These probes hit the PUBLIC storefront, which
 * is the same thing a user's device sees, and turn that into a precise, actionable
 * verdict.
 *
 * Both probes are unauthenticated GETs against public endpoints, never throw, and
 * degrade to `unknown` (never a false "not published") when the network is down —
 * an outage must not be reported to an operator as "your app is unpublished".
 */

/** Verdict for one store. `unknown` = the probe itself failed; do NOT treat as not-live. */
export type StoreLivenessStatus = "live" | "not-published" | "unknown"

export interface StoreLiveness {
  store: "google_play" | "app_store"
  /** The identifier probed (packageName / bundleId). */
  id: string
  status: StoreLivenessStatus
  /** True only for a confirmed live listing. `unknown` is never live. */
  live: boolean
  /** Public storefront URL an operator can open to see exactly what we saw. */
  url: string
  /** Operator-facing explanation. Always present. */
  message: string
}

/** Public listing URL for a Play package — the page a device's Play app resolves. */
export function playListingUrl(packageName: string): string {
  return `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`
}

/** Public lookup URL for an App Store bundle id (iTunes Search API). */
export function appStoreLookupUrl(bundleId: string): string {
  return `https://itunes.apple.com/lookup?bundleId=${encodeURIComponent(bundleId)}`
}

/**
 * The message shown when an app exists on the console but is not published. This is
 * the operator's next action, not a diagnosis — the product and its base plan/offer
 * ARE created correctly; only activation is gated on publishing.
 */
export function notPublishedGuidance(store: "google_play" | "app_store", id: string): string {
  return store === "google_play"
    ? `App is not published on Play Store (${id}). The product was created, but Play blocks ` +
        `base-plan activation until the app is published on at least one track. Go ahead and ` +
        `activate the base plan manually in Play Console once the app is published ` +
        `(Monetize → Subscriptions → your plan → Activate), or re-run this sync after publishing.`
    : `App is not live on the App Store (${id}). The subscription was created, but it stays in ` +
        `"Waiting for Review"/"Missing Metadata" until the app itself is published. Go ahead and ` +
        `submit/activate it manually in App Store Connect, or re-run this sync after the app is live.`
}

/**
 * Short-lived memo so a bulk drain over N products does not issue N identical probes
 * against the public storefront (which would look like scraping and slow the drain).
 * Deliberately tiny: liveness changes at human speed, but an operator who just hit
 * "Publish" should not wait long to see it reflected.
 */
const TTL_MS = 60_000
const cache = new Map<string, { at: number; value: StoreLiveness }>()

/** Test seam — clears the memo. */
export function __clearLivenessCache(): void {
  cache.clear()
}

function memo(key: string, value: StoreLiveness): StoreLiveness {
  cache.set(key, { at: Date.now(), value })
  return value
}

function cached(key: string): StoreLiveness | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.value
}

async function getWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Play serves a consent interstitial / alternate markup to unknown agents.
        "User-Agent": "Mozilla/5.0 (compatible; PayCraft-store-liveness/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
      },
    })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Is the Android app LIVE on the Play Store?
 *
 * A published listing returns 200; an app that exists only as a draft on Play Console
 * (or a package that was never published) returns 404 — the store has no public page
 * for it. Anything else (5xx, network failure, timeout) is `unknown`.
 */
export async function checkPlayAppLive(
  packageName: string,
  opts: { timeoutMs?: number } = {},
): Promise<StoreLiveness> {
  const url = playListingUrl(packageName)
  const key = `play:${packageName}`
  const hit = cached(key)
  if (hit) return hit

  if (!packageName) {
    return {
      store: "google_play",
      id: packageName,
      status: "unknown",
      live: false,
      url,
      message: "no package name configured for this tenant — cannot check Play listing",
    }
  }

  try {
    const res = await getWithTimeout(url, opts.timeoutMs ?? 8_000)
    if (res.status === 200) {
      return memo(key, {
        store: "google_play",
        id: packageName,
        status: "live",
        live: true,
        url,
        message: `App is live on Play Store (${packageName}).`,
      })
    }
    if (res.status === 404) {
      return memo(key, {
        store: "google_play",
        id: packageName,
        status: "not-published",
        live: false,
        url,
        message: notPublishedGuidance("google_play", packageName),
      })
    }
    // 429/5xx/consent-wall — the store is not telling us anything reliable.
    return {
      store: "google_play",
      id: packageName,
      status: "unknown",
      live: false,
      url,
      message: `Could not determine Play listing status (HTTP ${res.status}) — open ${url} to check.`,
    }
  } catch (e: any) {
    const why = e?.name === "AbortError" ? "timed out" : (e?.message ?? String(e))
    return {
      store: "google_play",
      id: packageName,
      status: "unknown",
      live: false,
      url,
      message: `Could not reach the Play Store to check listing status (${why}) — open ${url} to check.`,
    }
  }
}

/**
 * Is the iOS app LIVE on the App Store?
 *
 * The iTunes lookup API returns `resultCount: 0` for a bundle id with no published
 * app — the same "no public listing" signal as Play's 404. A non-200 or a malformed
 * body is `unknown`.
 */
export async function checkAppStoreAppLive(
  bundleId: string,
  opts: { timeoutMs?: number } = {},
): Promise<StoreLiveness> {
  const url = appStoreLookupUrl(bundleId)
  const key = `asc:${bundleId}`
  const hit = cached(key)
  if (hit) return hit

  if (!bundleId) {
    return {
      store: "app_store",
      id: bundleId,
      status: "unknown",
      live: false,
      url,
      message: "no bundle id configured for this tenant — cannot check App Store listing",
    }
  }

  try {
    const res = await getWithTimeout(url, opts.timeoutMs ?? 8_000)
    if (!res.ok) {
      return {
        store: "app_store",
        id: bundleId,
        status: "unknown",
        live: false,
        url,
        message: `Could not determine App Store listing status (HTTP ${res.status}) — open ${url} to check.`,
      }
    }
    const body = await res.json()
    const count = typeof body?.resultCount === "number" ? body.resultCount : null
    if (count === null) {
      return {
        store: "app_store",
        id: bundleId,
        status: "unknown",
        live: false,
        url,
        message: `App Store lookup returned an unexpected body — open ${url} to check.`,
      }
    }
    if (count > 0) {
      const name = body?.results?.[0]?.trackName
      return memo(key, {
        store: "app_store",
        id: bundleId,
        status: "live",
        live: true,
        url,
        message: `App is live on the App Store (${name ? `${name}, ` : ""}${bundleId}).`,
      })
    }
    return memo(key, {
      store: "app_store",
      id: bundleId,
      status: "not-published",
      live: false,
      url,
      message: notPublishedGuidance("app_store", bundleId),
    })
  } catch (e: any) {
    const why = e?.name === "AbortError" ? "timed out" : (e?.message ?? String(e))
    return {
      store: "app_store",
      id: bundleId,
      status: "unknown",
      live: false,
      url,
      message: `Could not reach the App Store to check listing status (${why}) — open ${url} to check.`,
    }
  }
}
