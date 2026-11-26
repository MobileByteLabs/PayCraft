// The Analytics funnel from migration 213's paywall_funnel_stats (paycraft-attempt-observability sub-plan 07):
// counts aggregated in SQL (no 1 000-row API cap) and "Paid" from provider-confirmed purchases. These tests pin
// the mapping from the RPC's JSON onto the funnel rows and split tables the page already renders.
import { fetchFunnelStats, funnelFromStats, splitsFromStats, type FunnelStats } from "@/lib/funnel"

const stats: FunnelStats = {
  viewed: 726,
  picked: 59,
  checkout: 95,
  paid: 5,
  by_country: [
    { key: "unknown", viewers: 700, checkouts: 90, paid: 0 },
    { key: "IN", viewers: 26, checkouts: 5, paid: 1 },
    { key: "US", viewers: 0, checkouts: 0, paid: 4 },
  ],
  by_provider: [
    { key: "google_play", checkouts: 95, paid: 1 },
    { key: "stripe", checkouts: 0, paid: 4 },
  ],
}

describe("funnelFromStats", () => {
  it("maps the four stages with drops and share of viewers", () => {
    const rows = funnelFromStats(stats)
    expect(rows.map((r) => [r.stage, r.users])).toEqual([
      ["paycraft_paywall_view", 726],
      ["paycraft_plan_select", 59],
      ["paycraft_checkout_start", 95],
      ["paycraft_purchase_success", 5],
    ])
    expect(rows[0].dropFromPrev).toBeNull()
    expect(rows[3].ofFirst).toBeCloseTo(5 / 726)
    expect(rows[3].dropFromPrev).toBeCloseTo(1 - 5 / 95)
  })

  it("never divides by an empty previous stage", () => {
    const rows = funnelFromStats({ ...stats, viewed: 0, picked: 0, checkout: 0, paid: 0, by_country: [], by_provider: [] })
    expect(rows.every((r) => r.dropFromPrev === null && r.ofFirst === null)).toBe(true)
  })
})

describe("splitsFromStats", () => {
  it("keeps provider-confirmed payers in each split", () => {
    const { byCountry, byProvider } = splitsFromStats(stats)
    expect(byCountry.find((r) => r.key === "US")).toEqual({ key: "US", viewers: 0, checkouts: 0, payers: 4 })
    expect(byProvider.find((r) => r.key === "stripe")).toEqual({ key: "stripe", viewers: 0, checkouts: 0, payers: 4 })
    expect(byProvider.reduce((s, r) => s + r.payers, 0)).toBe(stats.paid)
  })

  it("drops a row with nothing in it (events of other steps that carry no country)", () => {
    const { byCountry } = splitsFromStats({ ...stats, by_country: [...stats.by_country, { key: "FR", viewers: 0, checkouts: 0, paid: 0 }] })
    expect(byCountry.map((r) => r.key)).toEqual(["unknown", "IN", "US"])
  })
})

describe("fetchFunnelStats", () => {
  it("calls paywall_funnel_stats with tenant, mode and window, and throws on an RPC error", async () => {
    const calls: Array<[string, unknown]> = []
    const ok = { rpc: async (fn: string, args: unknown) => (calls.push([fn, args]), { data: stats, error: null }) }
    await expect(fetchFunnelStats(ok as never, "t-1", "live", "2026-11-18T00:00:00Z")).resolves.toEqual(stats)
    expect(calls[0]).toEqual(["paywall_funnel_stats", { p_tenant_id: "t-1", p_mode: "live", p_since: "2026-11-18T00:00:00Z" }])
    const bad = { rpc: async () => ({ data: null, error: { message: "boom" } }) }
    await expect(fetchFunnelStats(bad as never, "t-1", "live", "x")).rejects.toThrow("boom")
  })
})
