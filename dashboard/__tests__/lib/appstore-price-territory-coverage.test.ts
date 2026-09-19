/**
 * Regression tests for App Store subscription PRICE TERRITORY COVERAGE.
 *
 * The incident (2026-09-17): all three cappy subscriptions sat in `MISSING_METADATA` with every
 * enumerable artifact present — availability, localizations, trial offer, review screenshot. The
 * cause was that they were available in 175 territories and priced in 1. The App Store Connect UI
 * equalizes prices across territories as you type, so this is invisible there; the API does not,
 * and creates exactly one price row per POST.
 *
 * Three separate faults kept it hidden, and each gets a test here:
 *   1. `ensurePrice` returned as soon as ANY price existed, so re-syncing could never repair it —
 *      the one row it had just created was proof to the next run that pricing was done.
 *   2. Its return value was discarded by both call sites, so an unsellable product reported `ok`.
 *   3. The equalizations request omitted `include=territory`, so the response carried no
 *      relationships, every territory classified as "no equalized price point", and the run
 *      reported 0 created / 0 failed — indistinguishable from having nothing to do.
 */

jest.mock("@/lib/store-jwt", () => ({
  appStoreConnectToken: jest.fn(() => "fake-asc-token"),
}))

import { syncProductToAppStore } from "@/lib/appstore-product-sync"

const CREDS = {
  keyId: "2X9R4HXF34",
  issuerId: "57246542-96fe-1a63-test",
  bundleId: "com.sensei.cappy",
  privateKeyP8: "test-placeholder-p8-mocked",
}

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const territoryRow = (id: string) => ({ id, type: "territories" })
const priceRow = (terr: string, point: string) => ({
  id: `price-${terr}`,
  relationships: {
    territory: { data: { type: "territories", id: terr } },
    subscriptionPricePoint: { data: { type: "subscriptionPricePoints", id: point } },
  },
})
const equalizationRow = (terr: string) => ({
  id: `PP_${terr}`,
  attributes: { customerPrice: "6.99" },
  relationships: { territory: { data: { type: "territories", id: terr } } },
})

/**
 * @param sold        territories the subscription is available in
 * @param alreadyPriced territories that already have a price row
 * @param equalizedFor territories Apple offers an equalized price point for
 */
function installFetch(opts: {
  sold: string[]
  alreadyPriced: string[]
  equalizedFor?: string[]
  priceCreateOk?: boolean
}) {
  const { sold, alreadyPriced, equalizedFor = sold, priceCreateOk = true } = opts
  const fetchMock = jest.fn(async (url: unknown, init: any) => {
    const u = String(url)
    const method = init?.method ?? "GET"

    if (u.includes("/v1/apps?filter[bundleId]")) return res({ data: [{ id: "APP1" }] })
    if (u.includes("/subscriptionGroups?limit=200")) return res({ data: [{ id: "GROUP1" }] })
    // Healthy group name (no trailing plan qualifier) → the rename path stays out of the way.
    if (u.includes("/subscriptionGroupLocalizations?limit=50")) {
      return res({ data: [{ id: "GLOC1", attributes: { name: "Cappy Plus", locale: "en-US" } }] })
    }
    if (u.includes("/subscriptions?filter[productId]")) return res({ data: [{ id: "SUB1" }] })
    if (u.includes("/subscriptionLocalizations")) {
      return res({ data: [{ id: "LOC1", attributes: { locale: "en-US", name: "n", description: "d" } }] })
    }
    if (u.includes("/appStoreReviewScreenshot")) {
      return res({ data: { id: "SHOT1", attributes: { assetDeliveryState: { state: "COMPLETE" } } } })
    }
    if (u.includes("/subscriptions/SUB1/subscriptionAvailability")) {
      return res({ data: { id: "AVAIL1", attributes: { availableInNewTerritories: true } } })
    }
    if (u.includes("/subscriptionAvailabilities/AVAIL1/availableTerritories")) {
      return res({ data: sold.map(territoryRow), meta: { paging: { total: sold.length } } })
    }
    if (u.includes("/subscriptions/SUB1/prices")) {
      const rows = alreadyPriced.map((t) => priceRow(t, `PP_${t}`))
      return res({ data: rows, meta: { paging: { total: rows.length } } })
    }
    if (u.includes("/equalizations")) {
      // Only supply relationships when the caller asked for them — mirroring the real API, which is
      // what made the missing `include=territory` silent rather than loud.
      const includesTerritory = u.includes("include=territory")
      const rows = equalizedFor
        .filter((t) => !alreadyPriced.includes(t))
        .map((t) => (includesTerritory ? equalizationRow(t) : { id: `PP_${t}`, attributes: {} }))
      return res({ data: rows })
    }
    if (u.includes("/v1/subscriptionPrices") && method === "POST") {
      return priceCreateOk ? res({ data: { id: "NEWPRICE" } }) : res({ errors: [{ detail: "nope" }] }, false, 409)
    }
    if (u.includes("/pricePoints")) return res({ data: [{ id: "PP_USA", attributes: { customerPrice: "6.99" } }] })
    return res({ data: [] })
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

const pricePosts = (m: jest.Mock) =>
  m.mock.calls.filter(
    ([u, init]) => String(u).includes("/v1/subscriptionPrices") && (init as any)?.method === "POST",
  )

const sync = (extra?: Partial<{ trialDays: number }>) =>
  syncProductToAppStore(
    CREDS,
    "prod-1",
    "cappy_plus_monthly",
    "Cappy Plus (Monthly)",
    "month",
    [{ currency: "USD", amountCents: 699 }],
    "com.sensei.cappy.sub.monthly",
    extra?.trialDays,
  )

beforeEach(() => jest.clearAllMocks())

test("prices EVERY available territory, not just the base one", async () => {
  const sold = ["USA", "FRA", "DEU", "IND", "GBR"]
  const fetchMock = installFetch({ sold, alreadyPriced: ["USA"] })

  const result = await sync()

  // One price per territory that lacked one — the whole point.
  expect(pricePosts(fetchMock)).toHaveLength(sold.length - 1)
  expect(result.pricingWarning).toBeUndefined()
})

test("requests equalizations WITH include=territory", async () => {
  const fetchMock = installFetch({ sold: ["USA", "FRA"], alreadyPriced: ["USA"] })

  await sync()

  const eqCall = fetchMock.mock.calls.find(([u]) => String(u).includes("/equalizations"))
  expect(eqCall).toBeDefined()
  // Without this the response carries no relationships and every territory is silently skipped.
  expect(String(eqCall![0])).toContain("include=territory")
})

test("a fully-priced subscription creates nothing on re-sync", async () => {
  const sold = ["USA", "FRA", "DEU"]
  const fetchMock = installFetch({ sold, alreadyPriced: sold })

  const result = await sync()

  expect(pricePosts(fetchMock)).toHaveLength(0)
  expect(result.pricingWarning).toBeUndefined()
})

test("reports a warning instead of success when territories cannot be priced", async () => {
  // Apple offers no equalized point for IND → it stays unpriced, and that must be visible.
  const fetchMock = installFetch({
    sold: ["USA", "FRA", "IND"],
    alreadyPriced: ["USA"],
    equalizedFor: ["USA", "FRA"],
  })

  const result = await sync()

  expect(pricePosts(fetchMock)).toHaveLength(1)
  expect(result.pricingWarning).toBeTruthy()
  expect(result.pricingWarning).toContain("IND")
})

test("surfaces a failed price creation rather than reporting a clean sync", async () => {
  const fetchMock = installFetch({
    sold: ["USA", "FRA", "DEU"],
    alreadyPriced: ["USA"],
    priceCreateOk: false,
  })

  const result = await sync()

  expect(pricePosts(fetchMock).length).toBeGreaterThan(0)
  expect(result.pricingWarning).toMatch(/409|priced 0/)
})
