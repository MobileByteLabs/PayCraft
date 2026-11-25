// The joined Analytics view's pieces render what the report says — and say plainly what it cannot
// (paycraft-ga4-analytics-audit sub-plan 03): a filter GA4 / provider truth could not apply, GA4 not connected,
// a segment GA4 has no row for. Rendered to static HTML, no browser needed.
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AnalyticsFilters } from "@/components/analytics/analytics-filters"
import { SegmentTable } from "@/components/analytics/segment-tables"
import { JoinedFunnel } from "@/components/analytics/joined-funnel"
import { AiAuditPanel, type AuditFinding } from "@/components/analytics/ai-audit-panel"

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

describe("AnalyticsFilters", () => {
  const options = { platforms: ["android", "ios"], countries: ["IN", "ID"], appVersions: ["2.4.1"], plans: ["pro-monthly", "pro-annual"] }

  it("is a GET form over the filters that keeps the range and shows the current choice", () => {
    const out = html(React.createElement(AnalyticsFilters, { days: 30, value: { platform: "android", country: "ID" }, options }))
    expect(out).toContain('method="get"')
    expect(out).toContain('name="range" value="30"')
    for (const name of ["platform", "country", "app_version", "plan"]) expect(out).toContain(`name="${name}"`)
    expect(out).toMatch(/<option value="android" selected="">/)
    expect(out).toMatch(/<option value="ID" selected="">/)
  })

  it("offers a way back to everything only when a filter is on", () => {
    expect(html(React.createElement(AnalyticsFilters, { days: 7, value: {}, options }))).not.toContain("Clear filters")
    const on = html(React.createElement(AnalyticsFilters, { days: 7, value: { plan: "pro-annual" }, options }))
    expect(on).toContain("Clear filters")
    expect(on).toContain('href="?range=7"')
  })
})

describe("SegmentTable", () => {
  it("shows GA4 beside PayCraft and a dash, never a zero, where GA4 has no row", () => {
    const out = html(React.createElement(SegmentTable, {
      title: "By platform",
      rows: [
        { key: "android", ga4Viewers: 1080, ga4Checkouts: 107, viewers: 900, checkouts: 95, paid: 1 },
        { key: "web", ga4Viewers: null, ga4Checkouts: null, viewers: 0, checkouts: 0, paid: 2 },
      ],
      label: (k: string) => k,
    }))
    expect(out).toContain("1,080")
    expect(out).toContain("By platform")
    expect(out).toMatch(/web<\/td><td[^>]*>—<\/td>/)
  })
})

describe("JoinedFunnel", () => {
  const paycraft = { viewed: 1625, picked: 136, checkout: 97, paid: 3, by_country: [], by_provider: [], paid_not_applied: ["app_version"] }

  it("puts GA4 users per step beside PayCraft's buyers and provider-confirmed Paid", () => {
    const out = html(React.createElement(JoinedFunnel, {
      ga4: [
        { event: "paycraft_paywall_view", users: 2013, events: 3755 },
        { event: "paycraft_plan_select", users: 74, events: 199 },
        { event: "paycraft_checkout_start", users: 108, events: 245 },
        { event: "paycraft_purchase_success", users: 2, events: 2 },
      ],
      ga4Status: "ok",
      paycraft,
      notApplied: { ga4: ["plan"], paid: ["app_version"] },
    }))
    expect(out).toContain("2,013")
    expect(out).toContain("1,625")
    expect(out).toContain("purchases the providers confirmed")
    expect(out).toContain("GA4 is not filtered by plan")
    expect(out).toContain("Paid is not filtered by app version")
  })

  it("under filters with no matching events, says why and still shows provider-confirmed Paid (not 'update your app')", () => {
    // Prod 2026-11-25: IN + Android showed "No paywall events yet — update your app" beside Paid = 1, because events
    // stored before the SDK sent a country cannot match a country filter.
    const out = html(React.createElement(JoinedFunnel, {
      ga4: null,
      ga4Status: "not_connected",
      paycraft: { ...paycraft, viewed: 0, picked: 0, checkout: 0, paid: 1, paid_not_applied: [] },
      notApplied: { ga4: [], paid: [] },
      filtered: true,
    }))
    expect(out).not.toContain("Update your app")
    expect(out).toContain("No PayCraft paywall events match these filters")
    expect(out).toMatch(/Paid — confirmed by the providers: <span[^>]*>1<\/span>/)
  })

  it("draws the GA4 bars with a colour the theme defines", () => {
    const out = html(React.createElement(JoinedFunnel, {
      ga4: [{ event: "paycraft_paywall_view", users: 10, events: 10 }], ga4Status: "ok", paycraft, notApplied: { ga4: [], paid: [] },
    }))
    expect(out).toContain("bg-info-500")
    expect(out).not.toContain("bg-info-400")
  })

  it("says why the GA4 column is empty", () => {
    const out = html(React.createElement(JoinedFunnel, { ga4: null, ga4Status: "not_connected", paycraft, notApplied: { ga4: [], paid: [] } }))
    expect(out).toContain("Connect GA4 below")
  })
})

describe("AiAuditPanel", () => {
  it("has an empty state that says how findings arrive", () => {
    expect(html(React.createElement(AiAuditPanel, { findings: [] }))).toContain("/idea-paycraft-analytics")
  })

  it("lists open findings first and shows what was done for a fixed one", () => {
    const findings: AuditFinding[] = [
      { id: "1", kind: "product_not_found", severity: "critical", title: "40 buyers could not buy", summary: "s", proposed_fix: "Check install source", status: "fixed", fixed_note: "SDK reports not_from_play", source: "command", window_start: "2026-11-18", window_end: "2026-11-25", created_at: "2026-11-25T10:00:00Z" },
      { id: "2", kind: "indonesia_abandon", severity: "high", title: "Indonesia leaves at plan pick", summary: "s", proposed_fix: "Offer a weekly plan", status: "open", fixed_note: null, source: "digest", window_start: "2026-11-18", window_end: "2026-11-25", created_at: "2026-11-25T11:00:00Z" },
    ]
    const out = html(React.createElement(AiAuditPanel, { findings }))
    expect(out.indexOf("Indonesia leaves")).toBeLessThan(out.indexOf("40 buyers"))
    expect(out).toContain("SDK reports not_from_play")
    expect(out).toContain("Offer a weekly plan")
  })
})
