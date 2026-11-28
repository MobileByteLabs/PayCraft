// Live page helpers (realtime-analytics spec): labels, 60-min aggregation, version deltas, stream buffer cap.
import {
  STREAM_CAP,
  compareVersionsDesc,
  countersFromCompare,
  countersFromEvents,
  eventLabel,
  minuteSeries,
  pushEvent,
  versionTable,
  ago,
  dateTime,
  describeEvent,
  exitLines,
  journeys,
  planName,
  rangeOf,
  seriesForRange,
  type LiveEvent,
  type VersionCompareRow,
} from "@/lib/live"

const row = (app_version: string | null, extra: Partial<VersionCompareRow> = {}): VersionCompareRow => ({
  app_version,
  devices: 0,
  paywall_views: 0,
  purchases: 0,
  purchase_rate: null,
  sign_in_views: 0,
  sign_in_completes: 0,
  sign_in_fails: 0,
  restores_found: 0,
  restores_not_found: 0,
  device_limit_views: 0,
  device_transfers: 0,
  first_seen: null,
  last_seen: null,
  ...extra,
})

const ev = (id: number, name: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({
  id,
  name,
  reason: null,
  provider: null,
  app_version: "1.0",
  country: "IN",
  platform: "android",
  mode: "live",
  occurred_at: "2026-11-28T10:30:00Z",
  ...extra,
})

describe("eventLabel", () => {
  it("maps catalog names and adds the restore / transfer reason", () => {
    expect(eventLabel("paycraft_paywall_view")).toBe("Paywall viewed")
    expect(eventLabel("paycraft_restore_result", "found")).toBe("Restore: found")
    expect(eventLabel("paycraft_restore_result", "not_found")).toBe("Restore: not found")
    expect(eventLabel("paycraft_device_transfer", "failed")).toBe("Device transfer: failed")
    expect(eventLabel("paycraft_sign_in_fail", "network")).toBe("Sign-in failed")
  })
  it("humanises an unknown name instead of dropping it", () => {
    expect(eventLabel("paycraft_new_thing")).toBe("New thing")
  })
})

describe("counters", () => {
  const rows = [
    row("1.1", { paywall_views: 10, purchases: 2, sign_in_completes: 3, sign_in_fails: 1, restores_found: 1, restores_not_found: 2, device_limit_views: 4 }),
    row("1.0", { paywall_views: 5, purchases: 1 }),
  ]
  it("sums compare rows, or one version", () => {
    expect(countersFromCompare(rows, null)).toMatchObject({ paywallViews: 15, purchases: 3, signInsOk: 3, signInsFailed: 1, restoresFound: 1, restoresNotFound: 2, deviceLimitViews: 4 })
    expect(countersFromCompare(rows, "1.0")).toMatchObject({ paywallViews: 5, purchases: 1, signInsOk: 0 })
  })
  it("counts raw events inside the window, splitting restores by reason", () => {
    const since = Date.parse("2026-11-28T10:00:00Z")
    const c = countersFromEvents(
      [
        ev(1, "paycraft_paywall_view"),
        ev(2, "paycraft_paywall_view", { occurred_at: "2026-11-28T09:00:00Z" }), // outside the hour
        ev(3, "paycraft_restore_result", { reason: "found" }),
        ev(4, "paycraft_restore_result", { reason: "not_found" }),
        ev(5, "paycraft_restore_result", { reason: "failed" }),
        ev(6, "paycraft_sign_in_fail"),
      ],
      since,
    )
    expect(c).toMatchObject({ paywallViews: 1, restoresFound: 1, restoresNotFound: 1, signInsFailed: 1 })
  })
})

describe("minuteSeries", () => {
  const now = Date.parse("2026-11-28T11:00:30Z")
  it("returns 60 bins ending at the current minute with views + purchases", () => {
    const s = minuteSeries(
      [
        { minute: "2026-11-28T11:00:00Z", name: "paycraft_paywall_view", app_version: "1.1", events: 4, devices: 3 },
        { minute: "2026-11-28T11:00:00Z", name: "paycraft_paywall_view", app_version: "1.0", events: 2, devices: 2 },
        { minute: "2026-11-28T10:01:00Z", name: "paycraft_purchase_success", app_version: "1.1", events: 1, devices: 1 },
        { minute: "2026-11-28T09:00:00Z", name: "paycraft_paywall_view", app_version: "1.1", events: 9, devices: 9 }, // too old
        { minute: "2026-11-28T10:30:00Z", name: "paycraft_plan_select", app_version: "1.1", events: 9, devices: 9 }, // not charted
      ],
      now,
      null,
    )
    expect(s).toHaveLength(60)
    expect(s[59]).toMatchObject({ label: "11:00", views: 6, purchases: 0 })
    expect(s[0]).toMatchObject({ label: "10:01", purchases: 1 })
    expect(s.reduce((n, p) => n + p.views, 0)).toBe(6)
  })
  it("filters by version", () => {
    const s = minuteSeries([{ minute: "2026-11-28T11:00:00Z", name: "paycraft_paywall_view", app_version: "1.0", events: 2, devices: 2 }], now, "1.1")
    expect(s[59].views).toBe(0)
  })
})

describe("versionTable", () => {
  it("orders newest version first (numeric-aware, unreported last)", () => {
    expect(["1.9", null, "1.10", "1.2"].sort(compareVersionsDesc)).toEqual(["1.10", "1.9", "1.2", null])
  })
  it("computes deltas vs the next-older version", () => {
    const t = versionTable([
      row("1.9", { purchase_rate: 0.1, sign_in_completes: 9, sign_in_fails: 1 }),
      row("1.10", { purchase_rate: 0.05, sign_in_completes: 6, sign_in_fails: 4 }),
    ])
    expect(t.map((r) => r.app_version)).toEqual(["1.10", "1.9"])
    expect(t[0].purchaseRateDelta).toBeCloseTo(-0.05)
    expect(t[0].failShare).toBeCloseTo(0.4)
    expect(t[0].failShareDelta).toBeCloseTo(0.3)
    expect(t[1].purchaseRateDelta).toBeNull()
  })
  it("no sign-in attempts → no fail share, no delta", () => {
    const t = versionTable([row("2.0", { purchase_rate: 0.2 }), row("1.0", { purchase_rate: null })])
    expect(t[0].failShare).toBeNull()
    expect(t[0].purchaseRateDelta).toBeNull()
  })
})

describe("pushEvent", () => {
  it("keeps newest first, drops duplicates, caps at 200", () => {
    let buf: LiveEvent[] = []
    for (let i = 1; i <= STREAM_CAP + 5; i++) buf = pushEvent(buf, ev(i, "paycraft_paywall_view"))
    expect(buf).toHaveLength(STREAM_CAP)
    expect(buf[0].id).toBe(STREAM_CAP + 5)
    expect(buf[STREAM_CAP - 1].id).toBe(6)
    expect(pushEvent(buf, ev(STREAM_CAP + 5, "paycraft_paywall_view"))).toBe(buf)
  })
})

// ── ranges, readable time, descriptions, journeys, exits (migration 225 page) ───────────────────────────────────

const evt = (o: Partial<LiveEvent> & { id: number; name: string; occurred_at: string }): LiveEvent => ({
  reason: null,
  provider: null,
  app_version: null,
  country: null,
  platform: "android",
  mode: "live",
  ...o,
})

describe("seriesForRange", () => {
  const now = Date.parse("2026-11-28T12:30:00Z")
  it("covers each range with the right number of buckets", () => {
    expect(seriesForRange([], now, rangeOf("1h"), null)).toHaveLength(60)
    expect(seriesForRange([], now, rangeOf("24h"), null)).toHaveLength(24)
    expect(seriesForRange([], now, rangeOf("7d"), null)).toHaveLength(168)
    expect(seriesForRange([], now, rangeOf("30d"), null)).toHaveLength(30)
  })
  it("puts hour rows into their hour and drops rows outside the range", () => {
    const rows = [
      { bucket: "2026-11-28T11:00:00Z", name: "paycraft_paywall_view", app_version: "v2", events: 4, devices: 3 },
      { bucket: "2026-11-28T11:00:00Z", name: "paycraft_purchase_success", app_version: "v2", events: 1, devices: 1 },
      { bucket: "2026-11-20T11:00:00Z", name: "paycraft_paywall_view", app_version: "v2", events: 9, devices: 9 },
    ]
    const bins = seriesForRange(rows, now, rangeOf("24h"), null)
    const hit = bins.find((b) => b.t === Date.parse("2026-11-28T11:00:00Z"))!
    expect(hit.views).toBe(4)
    expect(hit.purchases).toBe(1)
    expect(bins.reduce((s, b) => s + b.views, 0)).toBe(4)
  })
  it("filters by version", () => {
    const rows = [{ bucket: "2026-11-28T12:00:00Z", name: "paycraft_paywall_view", app_version: "v1", events: 2, devices: 2 }]
    expect(seriesForRange(rows, now, rangeOf("24h"), "v2").reduce((s, b) => s + b.views, 0)).toBe(0)
  })
})

describe("readable time", () => {
  it("dateTime shows day, month, year and time", () => {
    const s = dateTime("2026-11-28T06:44:02Z")
    expect(s).toMatch(/2026/)
    expect(s).toMatch(/Nov/)
    expect(s).toMatch(/\d{1,2}:\d{2}:\d{2}/)
  })
  it("ago reads naturally", () => {
    const now = Date.parse("2026-11-28T12:00:00Z")
    expect(ago("2026-11-28T11:59:40Z", now)).toBe("just now")
    expect(ago("2026-11-28T11:57:00Z", now)).toBe("3 min ago")
    expect(ago("2026-11-28T10:00:00Z", now)).toBe("2 h ago")
    expect(ago("2026-11-27T12:00:00Z", now)).toBe("1 day ago")
    expect(ago("2026-11-24T12:00:00Z", now)).toBe("4 days ago")
  })
})

describe("describeEvent", () => {
  const at = "2026-11-28T12:00:00Z"
  it("says where the buyer left and on which plan", () => {
    expect(describeEvent(evt({ id: 1, occurred_at: at, name: "paycraft_step_abandon", step: "plan", sku: "pro-quarterly" })))
      .toBe("Left while choosing a plan (Quarterly)")
    expect(describeEvent(evt({ id: 2, occurred_at: at, name: "paycraft_step_abandon", step: "checkout", reason: "store_cancelled", provider: "google_play", sku: "pro-monthly" })))
      .toBe("Closed Google Play's payment sheet without paying (Monthly)")
  })
  it("reads the funnel, survey and offer in plain words", () => {
    expect(describeEvent(evt({ id: 3, occurred_at: at, name: "paycraft_paywall_view", trigger: "home" }))).toBe("Opened the paywall from home")
    expect(describeEvent(evt({ id: 4, occurred_at: at, name: "paycraft_survey_answer", reason: "too_expensive" }))).toBe("Answered the exit survey: too expensive")
    expect(describeEvent(evt({ id: 5, occurred_at: at, name: "paycraft_offer_view", reason: "25pct" }))).toBe("Was offered a discount (25% off)")
    expect(describeEvent(evt({ id: 6, occurred_at: at, name: "paycraft_purchase_success", sku: "pro-annual", provider: "stripe" }))).toBe("Bought (Annual) with Stripe")
    expect(describeEvent(evt({ id: 7, occurred_at: at, name: "paycraft_restore_result", reason: "not_found" }))).toBe("Restore purchases — no subscription found")
  })
  it("never drops an unknown event", () => {
    expect(describeEvent(evt({ id: 8, occurred_at: at, name: "paycraft_brand_new_thing" }))).toBe("Brand new thing")
  })
  it("planName turns SKUs into plan names", () => {
    expect(planName("pro-semiannual")).toBe("Semiannual")
    expect(planName("pro_monthly")).toBe("Monthly")
    expect(planName("coins-100")).toBe("Coins 100")
    expect(planName(null)).toBeNull()
  })
})

describe("journeys", () => {
  it("groups a device's events into one visit and names where it ended", () => {
    const visits = journeys([
      evt({ id: 3, device_ref: "dev-aaaaaa1", occurred_at: "2026-11-28T12:02:00Z", name: "paycraft_step_abandon", step: "plan", sku: "pro-quarterly" }),
      evt({ id: 1, device_ref: "dev-aaaaaa1", occurred_at: "2026-11-28T12:00:00Z", name: "paycraft_paywall_view" }),
      evt({ id: 2, device_ref: "dev-aaaaaa1", occurred_at: "2026-11-28T12:01:00Z", name: "paycraft_plan_select", sku: "pro-quarterly" }),
    ])
    expect(visits).toHaveLength(1)
    expect(visits[0].events.map((e) => e.id)).toEqual([1, 2, 3])
    expect(visits[0].outcome).toBe("Left while choosing a plan (Quarterly)")
    expect(visits[0].bought).toBe(false)
    expect(visits[0].device).toBe("…aaaaa1")
  })
  it("starts a new visit after 30 quiet minutes and marks purchases", () => {
    const visits = journeys([
      evt({ id: 1, device_ref: "d1", occurred_at: "2026-11-28T10:00:00Z", name: "paycraft_paywall_view" }),
      evt({ id: 2, device_ref: "d1", occurred_at: "2026-11-28T11:00:00Z", name: "paycraft_paywall_view" }),
      evt({ id: 3, device_ref: "d1", occurred_at: "2026-11-28T11:01:00Z", name: "paycraft_purchase_success", sku: "pro-monthly" }),
    ])
    expect(visits).toHaveLength(2)
    expect(visits[0].outcome).toBe("Bought Monthly")
    expect(visits[0].bought).toBe(true)
  })
})

describe("exitLines", () => {
  it("describes each exit point with its share, biggest first", () => {
    const lines = exitLines([
      { name: "paycraft_offer_decline", step: "offer", reason: "", sku: "", exits: 1, devices: 1 },
      { name: "paycraft_step_abandon", step: "plan", reason: "", sku: "pro-quarterly", exits: 5, devices: 3 },
    ])
    expect(lines[0].description).toBe("Left while choosing a plan (Quarterly)")
    expect(lines[0].share).toBeCloseTo(0.75)
    expect(lines[1].description).toBe("Declined the discount")
  })
})

describe("compareVersionsDesc with 'unknown'", () => {
  it("sorts the unknown bucket last", () => {
    expect(["unknown", "2026.11.28", "2026.11.25"].sort(compareVersionsDesc)).toEqual(["2026.11.28", "2026.11.25", "unknown"])
  })
})
