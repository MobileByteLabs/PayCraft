/**
 * Tests for `lib/googleplay-readiness.ts` — does Google Play consider each subscription sellable?
 *
 * Play's failure modes differ from the App Store's and each has bitten here:
 *   · a base plan is created in DRAFT and is NOT purchasable until activated, and Play refuses
 *     activation while the app is unpublished — so a sync can succeed and leave nothing buyable
 *   · "no offers" comes back as **204 with an EMPTY body**, so `JSON.parse` throws and a naive
 *     reader turns a healthy trial-less plan into a crash
 *   · offers live on their OWN collection; `basePlans[].offers` is not populated by the subscription
 *     GET, so reading offers from the subscription reports every trial as missing (it did)
 *   · regions were set once at create and never revisited, leaving plans priced in one country
 *     while seven currencies were configured
 */

jest.mock("@/lib/store-jwt", () => ({
  playAccessToken: jest.fn(async () => "fake-play-token"),
}))

import { googlePlaySubscriptionReadiness } from "@/lib/googleplay-readiness"

const CREDS = { serviceAccountJson: JSON.stringify({ client_email: "x@y.iam", private_key: "k" }), packageName: "com.sensei.cappy" }

function res(body: unknown, ok = true, status = 200, raw?: string) {
  const text = raw !== undefined ? raw : JSON.stringify(body)
  return { ok, status, text: async () => text, json: async () => JSON.parse(text) }
}

function installFetch(opts: {
  state?: string
  regions?: number
  listings?: Array<{ title?: string; description?: string }>
  offers?: any[]
  offersStatus?: number
  subStatus?: number
  basePlans?: any[] | null
} = {}) {
  const {
    state = "ACTIVE",
    regions = 7,
    listings = [{ title: "Cappy Plus", description: "Everything unlocked" }],
    offers = [],
    offersStatus = 200,
    subStatus = 200,
    basePlans,
  } = opts

  const plan = {
    basePlanId: "bp-autorenew",
    state,
    regionalConfigs: Array.from({ length: regions }, (_, i) => ({ regionCode: `R${i}` })),
  }

  const fetchMock = jest.fn(async (url: unknown) => {
    const u = String(url)
    if (u.includes("/offers")) {
      // 204 + empty body is Play's real "no offers" answer.
      if (offersStatus === 204) return res(null, true, 204, "")
      return res({ subscriptionOffers: offers }, true, 200)
    }
    if (subStatus !== 200) return res(null, false, subStatus, "{}")
    return res({ listings, basePlans: basePlans === null ? [] : basePlans ?? [plan] })
  })
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
  return fetchMock
}

const P = (over: Partial<{ androidTrialDays: number | null; configuredCurrencies: number }> = {}) => [
  { id: "row-1", sku: "cappy_plus_annual", playProductId: "com.sensei.cappy.sub.year",
    androidTrialDays: null, configuredCurrencies: 7, ...over },
]

beforeEach(() => jest.clearAllMocks())

test("an ACTIVE, fully-regioned plan with no trial configured reads as ready", async () => {
  installFetch({ offersStatus: 204 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(r.ready).toBe(true)
  expect(r.state).toBe("ACTIVE")
  expect(r.blockers).toEqual([])
  expect(r.regions).toBe(7)
})

test("a 204 empty offers response does not crash and is not read as a missing trial", async () => {
  installFetch({ offersStatus: 204 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P({ androidTrialDays: 0 }))
  expect(r.ready).toBe(true)
})

test("a DRAFT base plan is a blocker — created but not purchasable", async () => {
  installFetch({ state: "DRAFT", offersStatus: 204 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(r.ready).toBe(false)
  expect(r.blockers.join(" ")).toMatch(/DRAFT — not purchasable/)
})

test("a plan priced in no regions cannot be sold anywhere", async () => {
  installFetch({ regions: 0, offersStatus: 204 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(r.ready).toBe(false)
  expect(r.blockers).toContain("base plan is priced in no regions — cannot be sold anywhere")
})

test("narrow region coverage is a WARNING, not a blocker — it still sells where priced", async () => {
  installFetch({ regions: 1, offersStatus: 204 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(r.ready).toBe(true)
  expect(r.warnings.join(" ")).toMatch(/priced in 1 region while the product declares 7 currencies/)
})

test("a configured trial with no active offer is a blocker — the paywall would lie", async () => {
  installFetch({ offersStatus: 204 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P({ androidTrialDays: 7 }))
  expect(r.ready).toBe(false)
  expect(r.blockers.join(" ")).toMatch(/7-day trial is configured for Android but no active free-trial offer/)
})

test("an active trial offer satisfies a configured trial (offers read from their own collection)", async () => {
  installFetch({
    offers: [{ offerId: "bp-autorenew-freetrial", state: "ACTIVE", phases: [{ duration: "P7D" }],
               regionalConfigs: Array.from({ length: 7 }, (_, i) => ({ regionCode: `R${i}` })) }],
  })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P({ androidTrialDays: 7 }))
  expect(r.ready).toBe(true)
  expect(r.warnings).toEqual([])
})

test("a trial offer narrower than its base plan is reported", async () => {
  installFetch({
    regions: 7,
    offers: [{ offerId: "o", state: "ACTIVE", phases: [{ duration: "P7D" }],
               regionalConfigs: [{ regionCode: "R0" }] }],
  })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P({ androidTrialDays: 7 }))
  expect(r.warnings.join(" ")).toMatch(/free-trial offer covers 1 of the base plan's 7 regions/)
})

test("a stale trial offer with no configured trial is a blocker", async () => {
  installFetch({
    offers: [{ offerId: "stale", state: "ACTIVE", phases: [{ duration: "P7D" }], regionalConfigs: [] }],
  })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P({ androidTrialDays: 0 }))
  expect(r.ready).toBe(false)
  expect(r.blockers.join(" ")).toMatch(/grants what the paywall does not advertise/)
})

test("a local product id pointing at no Play subscription is not ready", async () => {
  installFetch({ subStatus: 404 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(r.ready).toBe(false)
  expect(r.blockers[0]).toMatch(/no such subscription in Google Play/)
})

test("no base plan at all is a blocker", async () => {
  installFetch({ basePlans: null, offersStatus: 204 })
  const [r] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(r.ready).toBe(false)
  expect(r.blockers).toContain("no base plan — nothing to purchase")
})

test("a missing listing description warns; a missing title blocks", async () => {
  installFetch({ listings: [{ title: "Cappy Plus" }], offersStatus: 204 })
  const [a] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(a.ready).toBe(true)
  expect(a.warnings).toContain("store listing has no description")

  installFetch({ listings: [{ description: "d" }], offersStatus: 204 })
  const [b] = await googlePlaySubscriptionReadiness(CREDS, P())
  expect(b.ready).toBe(false)
  expect(b.blockers).toContain("store listing has no title")
})

test("an unsynced product is reported, not skipped", async () => {
  installFetch()
  const [r] = await googlePlaySubscriptionReadiness(CREDS, [
    { id: "row-2", sku: "x", playProductId: null, androidTrialDays: null },
  ])
  expect(r.ready).toBe(false)
  expect(r.blockers).toContain("not synced to Google Play")
})
