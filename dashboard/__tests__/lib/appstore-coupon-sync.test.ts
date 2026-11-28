/**
 * App Store coupons are PROMOTIONAL offers (signed per buyer by `winback`), never introductory offers — Apple gives
 * an intro offer to every new subscriber, which made a win-back coupon a public discount. Lengths are counted in the
 * plan's own period; a plan the duration doesn't fit is skipped.
 */
const calls: { path: string; init?: { method?: string; body?: string } }[] = []
let existingCodes: string[] = []
const updates: unknown[] = []

jest.mock("@/lib/store-jwt", () => ({ appStoreConnectToken: jest.fn(async () => "tok") }))
jest.mock("@/lib/appstore-product-sync", () => ({
  resolveAscSubscriptionId: jest.fn(async (_t: string, _b: string, productId: string) => `sub-${productId}`),
  ascFetch: jest.fn(async (_t: string, path: string, init?: { method?: string; body?: string }) => {
    calls.push({ path, init })
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" })
    if (path.includes("/promotionalOffers")) return json({ data: existingCodes.map((c) => ({ attributes: { offerCode: c } })) })
    if (path.includes("/pricePoints")) {
      return json({ data: [{ id: "pp-399", attributes: { customerPrice: "3.99" } }, { id: "pp-499", attributes: { customerPrice: "4.99" } }] })
    }
    return json({ data: { id: "created" } })
  }),
}))
jest.mock("@/lib/supabase-server", () => ({
  createClient: () => ({
    rpc: (fn: string) => ({
      single: async () => fn === "tenant_providers_store_status"
        ? { data: { connected: true, config: {} } }
        : { data: { credential: "p8", config: { key_id: "k", issuer_id: "i", bundle_id: "com.x" } } },
    }),
    from: (table: string) => {
      if (table === "tenant_products") {
        const rows = [
          { id: "m", app_store_product_id: "pro.monthly", interval: "month", type: "subscription" },
          { id: "q", app_store_product_id: "pro.quarterly", interval: "quarter", type: "subscription" },
          { id: "y", app_store_product_id: "pro.annual", interval: "year", type: "subscription" },
        ]
        const q: any = { select: () => q, eq: () => q, not: () => q, in: () => q, then: (r: any) => r({ data: rows }) }
        return q
      }
      if (table === "tenant_pricing") {
        return { select: () => ({ in: async () => ({ data: [
          { product_id: "m", amount_cents: 799, currency: "USD" },
          { product_id: "q", amount_cents: 1999, currency: "USD" },
          { product_id: "y", amount_cents: 5999, currency: "USD" },
        ] }) }) }
      }
      return { update: (v: unknown) => ({ eq: async () => { updates.push(v); return {} } }) }
    },
  }),
}))

import { ascPeriodDuration, promoOfferCode, syncCouponToAppStore } from "@/lib/appstore-coupon-sync"

const run = () => syncCouponToAppStore({
  tenantId: "t", couponRowId: "c", code: "EXIT50", percentOff: 50, duration: "repeating", durationInMonths: 3,
  appliesToProductIds: null,
})

beforeEach(() => { calls.length = 0; updates.length = 0; existingCodes = [] })

describe("syncCouponToAppStore", () => {
  it("creates promotional offers sized per plan, skips the annual plan, stores the offer code", async () => {
    const res = await run()
    const creates = calls.filter((c) => c.init?.method === "POST")
    expect(creates.map((c) => c.path)).toEqual(["/v1/subscriptionPromotionalOffers", "/v1/subscriptionPromotionalOffers"])
    expect(calls.some((c) => c.path.includes("introductoryOffers"))).toBe(false)
    const [monthly, quarterly] = creates.map((c) => JSON.parse(c.init!.body!))
    expect(monthly.data.attributes).toMatchObject({ offerMode: "PAY_AS_YOU_GO", duration: "ONE_MONTH", numberOfPeriods: 3, offerCode: "cpn.exit50" })
    expect(quarterly.data.attributes).toMatchObject({ duration: "THREE_MONTHS", numberOfPeriods: 1 })
    expect(monthly.included[0].relationships.subscriptionPricePoint.data.id).toBe("pp-399") // 7.99 × 50% ≈ 3.99
    expect(res!.offerIdsByProduct).toEqual({ m: "cpn.exit50", q: "cpn.exit50" })
    expect(res!.skipped!.join()).toMatch(/pro.annual.*doesn't fit a year plan/)
    expect(updates).toEqual([expect.objectContaining({ appstore_offer_ids: { m: "cpn.exit50", q: "cpn.exit50" } })])
  })

  it("reuses an offer that already has the code", async () => {
    existingCodes = ["cpn.exit50"]
    const res = await run()
    expect(calls.filter((c) => c.init?.method === "POST")).toHaveLength(0)
    expect(res!.offerIdsByProduct).toEqual({ m: "cpn.exit50", q: "cpn.exit50" })
  })

  it("maps every billing period and keeps codes StoreKit-safe", () => {
    expect(["month", "quarter", "semiannual", "year", null].map(ascPeriodDuration))
      .toEqual(["ONE_MONTH", "THREE_MONTHS", "SIX_MONTHS", "ONE_YEAR", "ONE_MONTH"])
    expect(promoOfferCode("Black-Friday 50")).toBe("cpn.black_friday_50")
  })
})
