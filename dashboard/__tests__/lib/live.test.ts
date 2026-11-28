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
