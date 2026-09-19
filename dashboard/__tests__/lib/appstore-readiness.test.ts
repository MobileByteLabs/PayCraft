/**
 * Tests for `lib/appstore-readiness.ts` — the surface that asks App Store Connect whether products
 * are sellable, instead of inferring it from our own rows.
 *
 * The case that matters most is the 2026-09-17 shape: `MISSING_METADATA` with a local product id
 * present and every sync reporting ok. A readiness check that only handled the happy path would have
 * been just as blind, so the not-ready cases are asserted down to the individual blocker strings.
 */

jest.mock("@/lib/store-jwt", () => ({
  appStoreConnectToken: jest.fn(() => "fake-asc-token"),
}))

import { appStoreSubscriptionReadiness } from "@/lib/appstore-readiness"

const CREDS = {
  keyId: "K",
  issuerId: "I",
  privateKeyP8: "test-placeholder-p8-mocked",
  bundleId: "com.sensei.cappy",
}

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

/** A store in a configurable condition. Defaults describe a fully healthy subscription. */
function installFetch(opts: {
  state?: string
  sold?: number
  priced?: number
  localizations?: Array<{ name?: string; description?: string }>
  screenshot?: string | null
  hasAvailability?: boolean
  subscriptionExists?: boolean
} = {}) {
  const {
    state = "READY_TO_SUBMIT",
    sold = 175,
    priced = 175,
    localizations = [{ name: "Cappy Plus", description: "Everything unlocked" }],
    screenshot = "COMPLETE",
    hasAvailability = true,
    subscriptionExists = true,
  } = opts

  const fetchMock = jest.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes("/v1/apps?filter[bundleId]")) return res({ data: [{ id: "APP1" }] })
    if (u.includes("/subscriptionGroups?limit=200")) return res({ data: [{ id: "GROUP1" }] })
    if (u.includes("/subscriptions?filter[productId]")) {
      return res({ data: subscriptionExists ? [{ id: "SUB1" }] : [] })
    }
    if (u.includes("/subscriptions/SUB1/subscriptionAvailability")) {
      return hasAvailability ? res({ data: { id: "AVAIL1" } }) : res({}, false, 404)
    }
    if (u.includes("/availableTerritories")) return res({ data: [], meta: { paging: { total: sold } } })
    if (u.includes("/subscriptions/SUB1/prices")) return res({ data: [], meta: { paging: { total: priced } } })
    if (u.includes("/subscriptionLocalizations")) {
      return res({ data: localizations.map((l, i) => ({ id: `L${i}`, attributes: l })) })
    }
    if (u.includes("/appStoreReviewScreenshot")) {
      return screenshot === null
        ? res({ data: null })
        : res({ data: { id: "S1", attributes: { assetDeliveryState: { state: screenshot } } } })
    }
    if (u.includes("/v1/subscriptions/SUB1")) return res({ data: { attributes: { state } } })
    return res({ data: [] })
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

const PRODUCTS = [{ id: "row-1", sku: "cappy_plus_monthly", appStoreProductId: "com.sensei.cappy.sub.monthly" }]

beforeEach(() => jest.clearAllMocks())

test("a fully-configured subscription reads as ready", async () => {
  installFetch()
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.ready).toBe(true)
  expect(r.state).toBe("READY_TO_SUBMIT")
  expect(r.blockers).toEqual([])
})

test("detects the incident shape: priced in fewer territories than it is sold in", async () => {
  installFetch({ state: "MISSING_METADATA", sold: 175, priced: 1 })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.ready).toBe(false)
  // The precise sentence an operator needs; "MISSING_METADATA" alone is what made this invisible.
  expect(r.blockers).toContain("priced in 1 of 175 territories")
  expect(r.pricedTerritories).toBe(1)
  expect(r.soldTerritories).toBe(175)
})

test("reports a missing review screenshot", async () => {
  installFetch({ state: "MISSING_METADATA", screenshot: null })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.blockers).toContain("no review screenshot")
})

test("reports an incomplete screenshot upload distinctly from an absent one", async () => {
  installFetch({ state: "MISSING_METADATA", screenshot: "UPLOAD_INCOMPLETE" })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.blockers).toContain("review screenshot UPLOAD_INCOMPLETE")
})

test("reports missing localization", async () => {
  installFetch({ state: "MISSING_METADATA", localizations: [] })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.blockers).toContain("no localization (display name + description)")
})

test("reports a localization that exists but is missing a description", async () => {
  installFetch({ state: "MISSING_METADATA", localizations: [{ name: "Cappy Plus" }] })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.blockers).toContain("localization missing a name or description")
})

test("reports absent availability", async () => {
  installFetch({ state: "MISSING_METADATA", hasAvailability: false })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.blockers).toContain("no availability configured")
})

test("a local product id pointing at no subscription is not ready", async () => {
  installFetch({ subscriptionExists: false })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.ready).toBe(false)
  expect(r.blockers[0]).toMatch(/no such subscription/)
})

test("an UNREACHABLE App Store is not reported as a missing product", async () => {
  // The resolver returns null for every failure, so a transient 429 used to read as "your product
  // does not exist" — a false blocker that halts a deploy and sends someone hunting a product that
  // is sitting right there. Observed twice on consecutive live calls.
  const fetchMock = jest.fn(async () => res({ errors: [{ status: "429" }] }, false, 429))
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock

  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.ready).toBe(false)
  expect(r.blockers[0]).toMatch(/could not verify with App Store Connect \(HTTP 429\)/)
  expect(r.blockers[0]).toMatch(/not evidence the product is missing/)
  expect(r.blockers.join(" ")).not.toMatch(/no such subscription/)
})

test("a reachable app with a genuinely absent subscription still reports absence", async () => {
  installFetch({ subscriptionExists: false })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.blockers[0]).toMatch(/no such subscription/)
  expect(r.blockers.join(" ")).not.toMatch(/could not verify/)
})

test("an unsynced product is reported, not skipped", async () => {
  installFetch()
  const [r] = await appStoreSubscriptionReadiness(CREDS, [
    { id: "row-2", sku: "cappy_plus_annual", appStoreProductId: null },
  ])
  expect(r.ready).toBe(false)
  expect(r.blockers).toContain("not synced to App Store")
})

test("never reports not-ready without stating a reason", async () => {
  // Every artifact present, yet the state is not sellable — the honest answer is that the cause is
  // unknown, never an empty blocker list that reads as "no problem found".
  installFetch({ state: "MISSING_METADATA" })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.ready).toBe(false)
  expect(r.blockers.length).toBeGreaterThan(0)
  expect(r.blockers[0]).toMatch(/no missing artifact identified/)
})

test("carries the product row id so a caller can target a heal", async () => {
  installFetch({ state: "MISSING_METADATA", priced: 1 })
  const [r] = await appStoreSubscriptionReadiness(CREDS, PRODUCTS)
  expect(r.id).toBe("row-1")
})
