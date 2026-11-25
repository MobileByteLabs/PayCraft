import { paymentHealth } from "@/lib/payment-health"
import { fakeSupabase } from "../support/fake-supabase"

// Ten live attempts of tenant-A inside the window, every number below computed by hand from them. Leak probes
// (tenant-B, test mode, before the window) sit beside them and must not move any number.
//
//   id  state             stage        provider     country  timeline
//   g1  granted           —            stripe       IN       started · checkout_opened · provider_result · granted
//   g2  granted           —            razorpay     IN       started · checkout_opened · provider_result · granted
//   g3  granted           —            google_play  US       started · provider_result · granted            (store lane)
//   f1  failed            provider     stripe       US       started · checkout_opened · failed
//   f2  failed            provider     stripe       US       started · checkout_opened · failed
//   p1  paid_not_granted  entitlement  stripe       IN       started · checkout_opened · provider_result · paid_not_granted
//   a1  abandoned         sdk          razorpay     IN       started · abandoned                  + nudge scheduled
//   a2  abandoned         sdk          razorpay     IN       started · abandoned                  + nudge skipped (no permission)
//   a3  abandoned         sdk          stripe       —        started · paycraft_checkout_start · checkout_opened · abandoned + nudge scheduled
//   a4  abandoned         sdk          stripe       US       started · paycraft_checkout_start · abandoned + nudge skipped (disabled — not a permission miss)
const A = "tenant-A"
const B = "tenant-B"
const SINCE = "2026-11-18T00:00:00Z"
const T = "2026-11-24T10:00:00Z"

const att = (id: string, state: string, stage: string | null, provider: string, o: Record<string, unknown> = {}) =>
  ({ id: `row-${id}`, attempt_id: id, tenant_id: A, mode: "live", state, stage, provider, started_at: T, ...o })
const ev = (attempt_id: string, event: string, o: Record<string, unknown> = {}) =>
  ({ attempt_id, tenant_id: A, event, stage: "sdk", error_code: null, occurred_at: T, ...o })
const pe = (attempt_id: string, country: string, o: Record<string, unknown> = {}) =>
  ({ attempt_id, tenant_id: A, mode: "live", country, occurred_at: T, ...o })

function seed() {
  return fakeSupabase(seedTables())
}

function seedTables() {
  const timeline: Record<string, string[]> = {
    g1: ["started", "checkout_opened", "provider_result", "granted"],
    g2: ["started", "checkout_opened", "provider_result", "granted"],
    g3: ["started", "provider_result", "granted"],
    f1: ["started", "checkout_opened", "failed"],
    f2: ["started", "checkout_opened", "failed"],
    p1: ["started", "checkout_opened", "provider_result", "paid_not_granted"],
    a1: ["started", "abandoned"],
    a2: ["started", "abandoned"],
    a3: ["started", "paycraft_checkout_start", "checkout_opened", "abandoned"],
    a4: ["started", "paycraft_checkout_start", "abandoned"],
  }
  return {
    payment_attempts: [
      att("g1", "granted", null, "stripe"),
      att("g2", "granted", null, "razorpay"),
      att("g3", "granted", null, "google_play"),
      att("f1", "failed", "provider", "stripe", { error_code: "product_not_found" }),
      att("f2", "failed", "provider", "stripe", { error_code: "product_not_found" }),
      att("p1", "paid_not_granted", "entitlement", "stripe"),
      att("a1", "abandoned", "sdk", "razorpay"),
      att("a2", "abandoned", "sdk", "razorpay"),
      att("a3", "abandoned", "sdk", "stripe"),
      att("a4", "abandoned", "sdk", "stripe"),
      // leak probes
      att("xb", "failed", "provider", "stripe", { tenant_id: B }),
      att("xt", "failed", "webhook", "stripe", { mode: "test" }),
      att("xo", "failed", "server", "stripe", { started_at: "2026-11-01T00:00:00Z" }),
    ],
    attempt_events: [
      ...Object.entries(timeline).flatMap(([id, evs]) => evs.map((e) => ev(id, e))),
      ev("a1", "paycraft_nudge_scheduled"),
      ev("a3", "paycraft_nudge_scheduled"),
      ev("a2", "paycraft_nudge_skipped", { error_code: "skipped_no_permission" }),
      ev("a4", "paycraft_nudge_skipped", { error_code: "disabled" }),
      // leak probes: another tenant's nudge, a test-mode attempt's step
      ev("xb", "paycraft_nudge_scheduled", { tenant_id: B }),
      ev("xt", "checkout_opened"),
    ],
    paywall_events: [
      pe("g1", "IN"), pe("g2", "IN"), pe("g3", "US"), pe("f1", "US"), pe("f2", "US"),
      pe("p1", "IN"), pe("a1", "IN"), pe("a2", "IN"), pe("a4", "US"),
      // a3 has no paywall row → "unknown"; probes: tenant-B relabels f1, a test-mode row relabels g1
      pe("f1", "BR", { tenant_id: B }),
      pe("g1", "DE", { mode: "test" }),
    ],
  }
}

const run = () => paymentHealth(seed().client, A, "live", SINCE)

describe("paymentHealth", () => {
  it("totals the window's attempts by outcome", async () => {
    const h = await run()
    expect(h.totals).toEqual({ attempts: 10, granted: 3, failed: 2, paidNotGranted: 1, abandoned: 4, open: 0, grantRate: 0.3 })
    expect(h.paidNotGranted).toBe(1)
  })

  it("failure rate by stage = failures that ended at the stage ÷ all attempts", async () => {
    const h = await run()
    expect(h.byStage).toEqual([
      { key: "provider", total: 10, failed: 2, rate: 0.2 },
      { key: "entitlement", total: 10, failed: 1, rate: 0.1 },
    ])
  })

  it("says why payments failed: failures by reason (error code), unknown when none was reported", async () => {
    const h = await run()
    expect(h.byReason).toEqual([
      { key: "product_not_found", total: 10, failed: 2, rate: 0.2 },
      { key: "unknown", total: 10, failed: 1, rate: 0.1 },
    ])
  })

  // The API returns at most max_rows (1 000) per request; a page-less read silently dropped the rest. With a cap of
  // 3 rows per response, every number must still come out as if nothing were capped.
  it("reads every row, not just the first page the API returns", async () => {
    const capped = await paymentHealth(fakeSupabase(seedTables(), { maxRows: 3 }).client, A, "live", SINCE)
    const full = await run()
    expect(capped).toEqual(full)
  })

  // paycraft-ga4-analytics-audit sub-plan 03: the Analytics filters narrow Payment health too. Platform follows the
  // provider (google_play → android, app_store → ios, web PSPs → web); country follows the attempt's events.
  it("platform filter keeps only that platform's attempts", async () => {
    const h = await paymentHealth(seed().client, A, "live", SINCE, undefined, { platform: "android" })
    expect(h.totals.attempts).toBe(1) // g3, the only google_play attempt
    const web = await paymentHealth(seed().client, A, "live", SINCE, undefined, { platform: "web" })
    expect(web.totals.attempts).toBe(9)
  })

  it("country filter keeps only attempts whose events carry that country", async () => {
    const h = await paymentHealth(seed().client, A, "live", SINCE, undefined, { country: "us" })
    expect(h.totals.attempts).toBe(4) // g3, f1, f2, a4
    expect(h.byCountry.map((b) => b.key)).toEqual(["US"])
  })

  it("failure rate by provider counts failed + paid_not_granted over that provider's attempts", async () => {
    const h = await run()
    expect(h.byProvider).toEqual([
      { key: "stripe", total: 6, failed: 3, rate: 0.5 },
      { key: "razorpay", total: 3, failed: 0, rate: 0 },
      { key: "google_play", total: 1, failed: 0, rate: 0 },
    ])
  })

  it("country comes from the attempt's paywall events (server geo); none → unknown", async () => {
    const h = await run()
    expect(h.byCountry).toEqual([
      { key: "IN", total: 5, failed: 1, rate: 0.2 },
      { key: "US", total: 4, failed: 2, rate: 0.5 },
      { key: "unknown", total: 1, failed: 0, rate: 0 },
    ])
  })

  it("abandon rate by step = abandoned with that as the furthest step ÷ attempts that reached it", async () => {
    const h = await run()
    expect(h.abandonByStep).toEqual([
      { step: "plan_select", reached: 10, abandoned: 2, rate: 0.2 },
      { step: "checkout_open", reached: 7, abandoned: 2, rate: 2 / 7 },
      { step: "provider_result", reached: 6, abandoned: 0, rate: 0 }, // g1 g2 g3 p1 + f1 f2: a store refusal IS the provider replying
    ])
  })

  // /idea-paycraft-analytics 2026-11-26: Reels Downloader showed "Provider replied 0 / 0" beside 98 attempts Google Play
  // refused. A failure at provider / webhook / entitlement proves the provider answered; one at sdk / server does not —
  // and a store lane never proves checkout_open (no checkout page).
  it("a failure the provider reported proves the attempt reached the provider", async () => {
    const tables = {
      payment_attempts: [
        att("s1", "failed", "provider", "google_play", { error_code: "product_not_found" }),
        att("s2", "failed", "entitlement", "google_play"),
        att("s3", "failed", "sdk", "google_play", { error_code: "timeout" }),
      ],
      attempt_events: [ev("s1", "started"), ev("s2", "started"), ev("s3", "started")],
      paywall_events: [],
    }
    const h = await paymentHealth(fakeSupabase(tables).client, A, "live", SINCE)
    expect(h.abandonByStep).toEqual([
      { step: "plan_select", reached: 3, abandoned: 0, rate: 0 },
      { step: "checkout_open", reached: 0, abandoned: 0, rate: 0 },
      { step: "provider_result", reached: 2, abandoned: 0, rate: 0 },
    ])
  })

  it("nudge reach = scheduled ÷ (scheduled + skipped for no permission) = 2/3", async () => {
    const h = await run()
    expect(h.nudge).toEqual({ scheduled: 2, skippedNoPermission: 1, reach: 2 / 3 })
    expect(h.nudge.reach).toBeCloseTo(0.6667, 4)
  })

  it("every query is tenant-scoped and the window's start is applied", async () => {
    const { client, calls } = seed()
    await paymentHealth(client, A, "live", SINCE)
    // Reads are paged (readAll), so a table may be read more than once — every page must carry the same scope.
    expect([...new Set(calls.map((c) => c.table))].sort()).toEqual(["attempt_events", "payment_attempts", "paywall_events"])
    for (const c of calls) {
      expect(c.filters).toContain(`eq:tenant_id=${A}`)
      expect(c.filters.some((f) => f.startsWith("gte:"))).toBe(true)
    }
  })

  it("an empty window is all zeros with no nudge reach (not 0%)", async () => {
    const h = await paymentHealth(fakeSupabase({}).client, A, "live", SINCE)
    expect(h.totals.attempts).toBe(0)
    expect(h.totals.grantRate).toBe(0)
    expect(h.byStage).toEqual([])
    expect(h.abandonByStep.map((s) => s.rate)).toEqual([0, 0, 0])
    expect(h.nudge.reach).toBeNull()
  })
})
