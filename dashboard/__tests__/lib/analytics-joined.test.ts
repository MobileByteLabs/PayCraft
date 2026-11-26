// The joined Analytics report (paycraft-ga4-analytics-audit sub-plan 02): GA4 behaviour for the tenant's OWN streams
// (property 473327398 is shared by 17 apps), segmented by platform / country / app version, beside PayCraft's
// provider-truth funnel — one filter set narrowing both.
import { ga4Segments, type Ga4Deps } from "@/lib/ga4"

type Body = { dimensions?: { name: string }[]; dimensionFilter?: unknown }

function fakeGa4(rowsFor: (body: Body) => unknown[]) {
  const bodies: Body[] = []
  const deps: Ga4Deps = {
    saEmail: "sa@x.iam.gserviceaccount.com",
    token: async () => "tok",
    fetch: (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Body
      bodies.push(body)
      return new Response(JSON.stringify({ rows: rowsFor(body) }), { status: 200 })
    }) as typeof fetch,
  }
  return { deps, bodies }
}

const r = (dims: string[], metrics: number[]) => ({
  dimensionValues: dims.map((value) => ({ value })),
  metricValues: metrics.map((m) => ({ value: String(m) })),
})

const json = (v: unknown) => JSON.stringify(v)

describe("ga4Segments", () => {
  const STREAMS = ["10231617924", "13221627257"]

  it("filters every report to the tenant's own streams", async () => {
    const { deps, bodies } = fakeGa4(() => [])
    await ga4Segments("473327398", STREAMS, { days: 7 }, deps)
    expect(bodies.length).toBeGreaterThanOrEqual(5)
    for (const b of bodies) {
      expect(json(b.dimensionFilter)).toContain(`"fieldName":"streamId","inListFilter":{"values":["10231617924","13221627257"]}`)
    }
  })

  it("maps the filters onto GA4's own dimensions (platform, countryId, appVersion) and says plan cannot be", async () => {
    const { deps, bodies } = fakeGa4(() => [])
    const res = await ga4Segments("p", STREAMS, { days: 7, platform: "android", country: "ID", appVersion: "2.4.1", plan: "pro-annual" }, deps)
    const f = json(bodies[0].dimensionFilter)
    expect(f).toContain(`"fieldName":"platform","stringFilter":{"matchType":"EXACT","value":"android","caseSensitive":false}`)
    expect(f).toContain(`"fieldName":"countryId","stringFilter":{"matchType":"EXACT","value":"ID"}`)
    expect(f).toContain(`"fieldName":"appVersion","stringFilter":{"matchType":"EXACT","value":"2.4.1"}`)
    expect(res.ok && res.notApplied).toEqual(["plan"])
  })

  it("returns the paywall funnel by users and the segments by platform / country / app version", async () => {
    const { deps } = fakeGa4((b) => {
      const dims = (b.dimensions ?? []).map((d) => d.name).join(",")
      if (dims === "eventName") {
        return [r(["paycraft_paywall_view"], [1088, 3755]), r(["paycraft_plan_select"], [74, 199]), r(["paycraft_checkout_start"], [108, 245]), r(["paycraft_purchase_success"], [2, 2])]
      }
      if (dims === "platform,eventName") return [r(["Android", "paycraft_paywall_view"], [1080, 0]), r(["Android", "paycraft_checkout_start"], [107, 0]), r(["iOS", "paycraft_paywall_view"], [8, 0])]
      if (dims === "countryId,eventName") return [r(["IN", "paycraft_paywall_view"], [300, 0]), r(["IN", "paycraft_checkout_start"], [20, 0])]
      if (dims === "appVersion,eventName") return [r(["2.4.1", "paycraft_paywall_view"], [900, 0])]
      if (dims === "date") return [r(["20261124"], [1933]), r(["20261123"], [1700])]
      return []
    })
    const res = await ga4Segments("p", STREAMS, { days: 7 }, deps)
    if (!res.ok) throw new Error(res.error)
    expect(res.funnel.map((s) => [s.event, s.users])).toEqual([
      ["paycraft_paywall_view", 1088],
      ["paycraft_plan_select", 74],
      ["paycraft_checkout_start", 108],
      ["paycraft_purchase_success", 2],
    ])
    expect(res.byPlatform).toEqual([
      { key: "android", viewers: 1080, checkouts: 107 },
      { key: "ios", viewers: 8, checkouts: 0 },
    ])
    expect(res.byCountry[0]).toEqual({ key: "IN", viewers: 300, checkouts: 20 })
    expect(res.byAppVersion[0]).toEqual({ key: "2.4.1", viewers: 900, checkouts: 0 })
    expect(res.daily.map((d) => d.date)).toEqual(["2026-11-23", "2026-11-24"])
  })

  it("folds GA4's placeholder values ((not set), (other)) into unknown instead of passing them on as keys", async () => {
    // A "(NOT SET)" country reached Intl.DisplayNames and crashed the whole Analytics page (RangeError).
    const { deps } = fakeGa4((b) => {
      const dims = (b.dimensions ?? []).map((d) => d.name).join(",")
      if (dims === "countryId,eventName") return [r(["(not set)", "paycraft_paywall_view"], [5, 0]), r(["IN", "paycraft_paywall_view"], [9, 0])]
      if (dims === "appVersion,eventName") return [r(["(other)", "paycraft_paywall_view"], [2, 0])]
      if (dims === "platform,eventName") return [r(["(not set)", "paycraft_paywall_view"], [1, 0])]
      return []
    })
    const res = await ga4Segments("p", STREAMS, { days: 7 }, deps)
    if (!res.ok) throw new Error(res.error)
    expect(res.byCountry.map((x) => x.key)).toEqual(["IN", "unknown"])
    expect(res.byAppVersion.map((x) => x.key)).toEqual(["unknown"])
    expect(res.byPlatform.map((x) => x.key)).toEqual(["unknown"])
  })

  it("passes a 403 through as the Viewer fix, never an empty report", async () => {
    const deps: Ga4Deps = { saEmail: "sa@x", token: async () => "t", fetch: (async () => new Response("", { status: 403 })) as typeof fetch }
    const res = await ga4Segments("p", STREAMS, { days: 7 }, deps)
    expect(res).toEqual({ ok: false, error: "no_access", fix: "Add sa@x as a Viewer on GA4 property p." })
  })
})

import { joinedAnalytics } from "@/lib/analytics-joined"
import { fakeSupabase } from "../support/fake-supabase"

describe("joinedAnalytics", () => {
  const T = "tenant-1"
  const stats = { viewed: 10, picked: 4, checkout: 3, paid: 1, by_country: [], by_provider: [], paid_not_applied: [] }

  function client(connection: Record<string, unknown> | null) {
    const rpcCalls: Array<Record<string, unknown>> = []
    const { client } = fakeSupabase({ tenant_ga4_connections: connection ? [{ tenant_id: T, ...connection }] : [] })
    const sb = Object.assign(Object.create(client), {
      rpc: async (_fn: string, args: Record<string, unknown>) => (rpcCalls.push(args), { data: stats, error: null }),
    })
    return { sb, rpcCalls }
  }

  it("applies one filter set to PayCraft and to GA4, restricted to the tenant's streams", async () => {
    const { sb, rpcCalls } = client({ property_id: "473327398", verified_at: "2026-11-25T00:00:00Z", stream_ids: ["s1"] })
    const ga4Calls: unknown[][] = []
    const res = await joinedAnalytics(sb, T, "live", { days: 7, country: "ID", platform: "android" }, {
      account: { email: "sa@x", token: async () => "t" },
      segments: async (...args) => (ga4Calls.push(args), { ok: true, funnel: [], byPlatform: [], byCountry: [], byAppVersion: [], daily: [], withheld: false, notApplied: [] }),
    })
    expect(rpcCalls[0]).toMatchObject({ p_tenant_id: T, p_mode: "live", p_country: "ID", p_platform: "android" })
    expect(ga4Calls[0][0]).toBe("473327398")
    expect(ga4Calls[0][1]).toEqual(["s1"])
    expect(ga4Calls[0][2]).toMatchObject({ days: 7, country: "ID", platform: "android" })
    expect(res.ga4Status).toBe("ok")
    expect(res.paycraft.paid).toBe(1)
  })

  it("says why GA4 is absent instead of returning zeros", async () => {
    const none = await joinedAnalytics(client(null).sb, T, "live", { days: 7 }, { account: { email: "sa@x", token: async () => "t" } })
    expect(none.ga4Status).toBe("not_connected")
    expect(none.ga4).toBeNull()
    const noServer = await joinedAnalytics(client({ property_id: "p", verified_at: "x", stream_ids: [] }).sb, T, "live", { days: 7 }, { account: null })
    expect(noServer.ga4Status).toBe("not_set_up")
    const unverified = await joinedAnalytics(client({ property_id: "p", verified_at: null, stream_ids: [] }).sb, T, "live", { days: 7 }, { account: { email: "sa@x", token: async () => "t" } })
    expect(unverified.ga4Status).toBe("not_connected")
  })

  it("carries a GA4 error through as status error with its fix", async () => {
    const { sb } = client({ property_id: "p", verified_at: "x", stream_ids: [] })
    const res = await joinedAnalytics(sb, T, "live", { days: 7 }, {
      account: { email: "sa@x", token: async () => "t" },
      segments: async () => ({ ok: false, error: "no_access", fix: "Add sa@x as a Viewer on GA4 property p." }),
    })
    expect(res.ga4Status).toBe("error")
    expect(res.ga4Error).toEqual({ error: "no_access", fix: "Add sa@x as a Viewer on GA4 property p." })
  })
})

import { analyticsResponse } from "@/lib/attempt-api"

describe("GET /api/v1/analytics", () => {
  const T = "tenant-1"
  const stats = { viewed: 5, picked: 2, checkout: 1, paid: 1, by_country: [{ key: "ID", viewers: 5, checkouts: 1, paid: 1 }], by_provider: [], paid_not_applied: [] }

  function sbWith(rpcCalls: Array<Record<string, unknown>>) {
    const { client } = fakeSupabase({
      tenants: [{ id: T, plan: "pro" }],
      tier_definitions: [{ tier_name: "pro", analytics_retention_days: 90 }],
      payment_attempts: [{ id: "1", attempt_id: "a1", tenant_id: T, mode: "live", state: "failed", stage: "provider", error_code: "x", provider: "google_play", started_at: new Date().toISOString(), user_ref: "SECRET_HASH" }],
    })
    return Object.assign(Object.create(client), {
      rpc: async (_fn: string, args: Record<string, unknown>) => (rpcCalls.push(args), { data: stats, error: null }),
    })
  }

  const url = (q: string) => new URL(`https://x/api/v1/analytics?${q}`)

  it("answers with the joined report for the window and filters, without buyer identifiers", async () => {
    const calls: Array<Record<string, unknown>> = []
    const res = await analyticsResponse(sbWith(calls), T, url("days=30&country=id&platform=android&plan=pro-annual&app_version=2.4.1"), { account: null })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(calls[0]).toMatchObject({ p_country: "ID", p_platform: "android", p_plan: "pro-annual", p_app_version: "2.4.1" })
    expect(body.paycraft.paid).toBe(1)
    expect(body.ga4Status).toBe("not_set_up")
    expect(body.window.days).toBe(30)
    expect(JSON.stringify(body)).not.toMatch(/SECRET_HASH|user_ref|@/)
  })

  it("refuses a malformed filter with a 400 that names it", async () => {
    for (const [q, error] of [["country=India", "invalid_country"], ["platform=toaster", "invalid_platform"], ["days=5", "invalid_days"], ["plan=Pro Annual!", "invalid_plan"], ["app_version=" + "9".repeat(40), "invalid_app_version"]] as const) {
      const res = await analyticsResponse(sbWith([]), T, url(q), { account: null })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe(error)
    }
  })

  it("caps the window at the plan's analytics retention and says so", async () => {
    const { client } = fakeSupabase({ tenants: [{ id: T, plan: "free" }], tier_definitions: [{ tier_name: "free", analytics_retention_days: 7 }] })
    const sb = Object.assign(Object.create(client), { rpc: async () => ({ data: stats, error: null }) })
    const body = await (await analyticsResponse(sb, T, url("days=90"), { account: null })).json()
    expect(body.window).toMatchObject({ days: 7, capped: true })
  })
})

import { segmentRows } from "@/lib/analytics-joined"

describe("segmentRows", () => {
  it("lines GA4 and PayCraft up per key, provider-confirmed paid beside GA4 behaviour", () => {
    const rows = segmentRows(
      [{ key: "android", viewers: 1080, checkouts: 107 }, { key: "ios", viewers: 8, checkouts: 0 }],
      [{ key: "android", viewers: 900, checkouts: 95, paid: 1 }, { key: "web", viewers: 0, checkouts: 0, paid: 2 }],
    )
    expect(rows).toEqual([
      { key: "android", ga4Viewers: 1080, ga4Checkouts: 107, viewers: 900, checkouts: 95, paid: 1 },
      { key: "ios", ga4Viewers: 8, ga4Checkouts: 0, viewers: 0, checkouts: 0, paid: 0 },
      { key: "web", ga4Viewers: null, ga4Checkouts: null, viewers: 0, checkouts: 0, paid: 2 },
    ])
  })

  it("without GA4 the GA4 columns are null, never zero", () => {
    expect(segmentRows(null, [{ key: "IN", viewers: 3, checkouts: 1, paid: 0 }])).toEqual([
      { key: "IN", ga4Viewers: null, ga4Checkouts: null, viewers: 3, checkouts: 1, paid: 0 },
    ])
  })
})

describe("All time (migration 217)", () => {
  it("asks GA4 for its earliest date instead of a day count it would refuse", async () => {
    const bodies: Array<{ dateRanges: unknown }> = []
    const deps = {
      saEmail: "sa@x", token: async () => "t",
      fetch: (async (_u: string, init?: RequestInit) => (bodies.push(JSON.parse(String(init?.body))), new Response(JSON.stringify({ rows: [] })))) as typeof fetch,
    }
    await ga4Segments("p", [], { days: 36500 }, deps)
    expect(bodies[0].dateRanges).toEqual([{ startDate: "2015-08-14", endDate: "today" }])
    await ga4Segments("p", [], { days: 30 }, deps)
    expect(bodies.at(-1)!.dateRanges).toEqual([{ startDate: "30daysAgo", endDate: "today" }])
  })

  it("the API takes days=all", async () => {
    const { client } = fakeSupabase({ tenants: [{ id: "t", plan: "pro" }], tier_definitions: [{ tier_name: "pro", analytics_retention_days: 36500 }] })
    const sb = Object.assign(Object.create(client), { rpc: async () => ({ data: { viewed: 0, picked: 0, checkout: 0, paid: 0, by_country: [], by_provider: [] }, error: null }) })
    const body = await (await analyticsResponse(sb, "t", new URL("https://x/api/v1/analytics?days=all"), { account: null })).json()
    expect(body.window).toMatchObject({ days: 36500, capped: false })
  })
})
