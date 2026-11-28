import { describe, expect, it } from "@jest/globals"
import {
  EXPERIMENT_TEMPLATES,
  confidence,
  mainCurrency,
  revenuePerViewer,
  trialToPaid,
  validateExperiment,
  winner,
  type ResultRow,
  type TemplateContext,
} from "@/lib/experiments"

const ctx = (over: Partial<TemplateContext> = {}): TemplateContext => ({
  offerings: [
    { id: "o1", is_current: true, plans: [
      { sku: "pro-monthly", display_name: "Monthly", interval: "month" },
      { sku: "pro-annual", display_name: "Annual", interval: "year" },
    ] },
    { id: "o2", plans: [{ sku: "pro-monthly-trial", display_name: "Monthly", interval: "month" }] },
  ],
  coupons: [{ id: "c50", code: "EXIT50", percent_off: 50 }, { id: "c30", code: "EXIT30", percent_off: 30 }],
  exitCouponId: "c50",
  today: "2026-11-28",
  ...over,
})
const tpl = (id: string) => EXPERIMENT_TEMPLATES.find((t) => t.id === id)!
const skus = { o1: ["pro-monthly", "pro-annual"], o2: ["pro-monthly-trial"] }

describe("experiment templates (227)", () => {
  it("every template builds a draft the database would accept", () => {
    for (const t of EXPERIMENT_TEMPLATES) {
      expect(t.needs(ctx())).toBeNull()
      const d = t.build(ctx())
      expect(validateExperiment(d, ["o1", "o2"], skus)).toBeNull()
      expect(d.key).toMatch(/2026-11-28$/)
    }
  })

  it("keeps the exit offer on in every arm unless the test is about it", () => {
    for (const t of EXPERIMENT_TEMPLATES.filter((x) => x.id !== "exit-offer")) {
      expect(t.build(ctx()).variants.every((v) => v.exit_offer !== false)).toBe(true)
    }
    expect(tpl("exit-offer").build(ctx()).variants.map((v) => v.exit_offer ?? true)).toEqual([true, false])
  })

  it("fills in the real plans, coupons and offerings", () => {
    expect(tpl("preselect-annual").build(ctx()).variants.map((v) => v.default_sku)).toEqual(["pro-monthly", "pro-annual"])
    expect(tpl("discount-size").build(ctx()).variants[1]).toMatchObject({ key: "30pct", exit_offer_coupon_id: "c30" })
    expect(tpl("paywall-design").build(ctx()).variants[1].paywall_template).toBe("minimal")
    expect(tpl("plan-lineup").build(ctx()).variants.map((v) => v.offering_id)).toEqual(["o1", "o2"])
  })

  it("says what is missing instead of building a broken test", () => {
    expect(tpl("exit-offer").needs(ctx({ exitCouponId: null }))).toMatch(/exit-offer coupon/)
    expect(tpl("discount-size").needs(ctx({ coupons: [{ id: "c50", code: "EXIT50", percent_off: 50 }] }))).toMatch(/second/)
    expect(tpl("plan-lineup").needs(ctx({ offerings: [ctx().offerings[0]] }))).toMatch(/second offering/)
    expect(tpl("preselect-annual").needs(ctx({ offerings: [{ id: "o1", is_current: true, plans: [] }] }))).toMatch(/annual/)
  })

  it("refuses an unknown design or a non-boolean exit offer", () => {
    const d = tpl("paywall-design").build(ctx())
    expect(validateExperiment({ ...d, variants: [d.variants[0], { ...d.variants[1], paywall_template: "fancy" }] }, ["o1"]))
      .toBe("experiment_template_unknown")
    expect(validateExperiment({ ...d, variants: [d.variants[0], { ...d.variants[1], exit_offer: "no" as unknown as boolean }] }, ["o1"]))
      .toBe("experiment_exit_offer_invalid")
  })
})

describe("results (227)", () => {
  const row = (variant: string, viewers: number, buyers: number, revenue: Record<string, number> = {}): ResultRow =>
    ({ variant, viewers, checkouts: buyers, buyers, conversion: viewers ? buyers / viewers : 0, revenue })

  it("revenue per viewer in the main currency", () => {
    const rows = [row("a", 200, 2, { INR: 159800 }), row("b", 100, 1, { INR: 99900, USD: 999 })]
    expect(mainCurrency(rows)).toBe("INR")
    expect(revenuePerViewer(rows[0], "INR")).toBeCloseTo(7.99)
    expect(revenuePerViewer(row("c", 0, 0), "INR")).toBe(0)
    expect(mainCurrency([row("a", 1, 0)])).toBeNull()
  })

  it("confidence is 1 − p; the winner is a significantly better arm, else the control", () => {
    const control = row("control", 1000, 20)
    const better = row("b", 1000, 50)
    expect(confidence(control, better)!).toBeGreaterThan(0.99)
    expect(confidence(control, row("x", 0, 0))).toBeNull()
    expect(winner([control, better])).toBe("b")
    expect(winner([control, row("b", 1000, 22)])).toBe("control")
    expect(winner([row("control", 0, 0), row("b", 0, 0)])).toBeNull()
  })
})

describe("trial → paid (228)", () => {
  it("is the share of trials that turned paid, null without trials", () => {
    expect(trialToPaid({ trial_starts: 4, trial_paid: 1 })).toBe(0.25)
    expect(trialToPaid({ trial_starts: 0, trial_paid: 0 })).toBeNull()
    expect(trialToPaid({})).toBeNull()
  })
})
