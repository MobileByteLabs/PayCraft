// The paywall funnel the dashboard shows (paycraft-paywall-analytics AC-6): stage counts are distinct buyers
// (a buyer who views the paywall three times is one viewer), drops are relative to the previous stage, and the
// country / provider splits add up to what was seen. Exact numbers, from PayCraft's own events table.
import { FUNNEL_STAGES, funnel, rangeDays, splitBy, type FunnelEvent } from "@/lib/funnel"

const ev = (name: string, who: string, extra: Partial<FunnelEvent> = {}): FunnelEvent =>
  ({ name, user_ref: null, device_ref: who, country: null, provider: null, ...extra })

describe("paywall funnel", () => {
  const events: FunnelEvent[] = [
    // four buyers see the paywall (b1 twice)
    ev("paycraft_paywall_view", "b1", { country: "IN" }), ev("paycraft_paywall_view", "b1", { country: "IN" }),
    ev("paycraft_paywall_view", "b2", { country: "IN" }), ev("paycraft_paywall_view", "b3", { country: "US" }),
    ev("paycraft_paywall_view", "b4", { country: null }),
    // three pick a plan, two start checkout, one pays
    ev("paycraft_plan_select", "b1"), ev("paycraft_plan_select", "b2"), ev("paycraft_plan_select", "b3"),
    ev("paycraft_checkout_start", "b1", { provider: "razorpay", country: "IN" }),
    ev("paycraft_checkout_start", "b3", { provider: "stripe", country: "US" }),
    ev("paycraft_purchase_success", "b1", { provider: "razorpay", country: "IN" }),
  ]

  it("counts distinct buyers per stage and the drop from the previous stage", () => {
    const f = funnel(events)
    expect(f.map((r) => r.stage)).toEqual([...FUNNEL_STAGES])
    expect(f.map((r) => r.users)).toEqual([4, 3, 2, 1])
    expect(f[0].dropFromPrev).toBeNull()
    expect(f[1].dropFromPrev).toBeCloseTo(0.25)
    expect(f[2].dropFromPrev).toBeCloseTo(1 / 3)
    expect(f[3].dropFromPrev).toBeCloseTo(0.5)
    expect(f[3].ofFirst).toBeCloseTo(0.25)
  })

  it("prefers the account over the device, so one buyer on two devices counts once", () => {
    const f = funnel([
      ev("paycraft_paywall_view", "phone", { user_ref: "u1" }),
      ev("paycraft_paywall_view", "laptop", { user_ref: "u1" }),
    ])
    expect(f[0].users).toBe(1)
  })

  it("splits viewers and payers by country, unknown kept as its own row", () => {
    const rows = splitBy(events, "country")
    const india = rows.find((r) => r.key === "IN")!
    expect(india.viewers).toBe(2)
    expect(india.checkouts).toBe(1)
    expect(india.payers).toBe(1)
    expect(rows.find((r) => r.key === "unknown")!.viewers).toBe(1)
    expect(rows.reduce((n, r) => n + r.viewers, 0)).toBe(4)
  })

  it("splits checkout starts and payers by provider", () => {
    const rows = splitBy(events, "provider")
    expect(rows.find((r) => r.key === "razorpay")).toMatchObject({ checkouts: 1, payers: 1 })
    expect(rows.find((r) => r.key === "stripe")).toMatchObject({ checkouts: 1, payers: 0 })
  })

  it("empty input gives zero stages, never NaN", () => {
    const f = funnel([])
    expect(f.map((r) => r.users)).toEqual([0, 0, 0, 0])
    expect(f.every((r) => r.dropFromPrev === null || Number.isFinite(r.dropFromPrev))).toBe(true)
    expect(splitBy([], "country")).toEqual([])
  })

  it("caps the requested range at the plan's retention", () => {
    expect(rangeDays("30", 90)).toEqual({ days: 30, capped: false })
    expect(rangeDays("90", 7)).toEqual({ days: 7, capped: true })
    expect(rangeDays(undefined, 90)).toEqual({ days: 30, capped: false })
    expect(rangeDays("bogus", 90)).toEqual({ days: 30, capped: false })
  })
})
