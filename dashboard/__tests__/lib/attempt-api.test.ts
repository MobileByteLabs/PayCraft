import { attemptResponse, clampWindow, funnelResponse, listAttemptsResponse, parseWindow, paymentHealthResponse } from "@/lib/attempt-api"
import { buyerRef } from "@/lib/attempts"
import { fakeSupabase } from "../support/fake-supabase"

// The bodies behind GET /api/v1/{attempts, attempts/{id}, payment-health, funnel} and the four paycraft_* MCP tools
// (paycraft-attempt-observability AC-17). The fake applies every filter the code builds, so a body that forgot its
// tenant predicate would return tenant-B's leak probes here exactly as it would against Postgres with the service key.

const A = "11111111-1111-1111-1111-111111111111"
const B = "22222222-2222-2222-2222-222222222222"
const NOW = new Date("2026-11-25T12:00:00Z")
const BUYER = "buyer@example.com"

const att = (id: string, o: Record<string, unknown> = {}) => ({
  id: `row-${id}`, attempt_id: id, tenant_id: A, provider: "stripe", mode: "live", plan: "pro-monthly", state: "failed",
  correlation: "exact", match_rule: null, stage: "provider", error_class: "declined", error_code: "card_declined",
  error_message: "Your card was declined.", started_at: "2026-11-24T10:00:00Z", paid_at: null, granted_at: null,
  closed_at: null, country: "IN", user_ref: "hash-other", provider_session_id: "cs_secret", ...o,
})

async function seed() {
  const me = await buyerRef(A, BUYER)
  return fakeSupabase({
    payment_attempts_geo: [
      att("a1", { id: "aaaaaaaa-0000-4000-8000-000000000001", user_ref: me }),
      att("a2", { id: "aaaaaaaa-0000-4000-8000-000000000002", country: "US" }),
      att("a3", { id: "aaaaaaaa-0000-4000-8000-000000000003", state: "granted", stage: null, provider: "razorpay" }),
      att("a4", { id: "aaaaaaaa-0000-4000-8000-000000000004", started_at: "2026-11-01T00:00:00Z" }),
      // tenant-B probe sharing a's attempt id shape: must never surface for tenant-A
      att("b1", { id: "bbbbbbbb-0000-4000-8000-000000000001", tenant_id: B }),
    ],
    attempt_events: [
      { attempt_id: "a1", tenant_id: A, event: "started", stage: "sdk", error_class: null, error_code: null, error_message: null, occurred_at: "2026-11-24T10:00:00Z" },
      { attempt_id: "a1", tenant_id: A, event: "failed", stage: "provider", error_class: "declined", error_code: "card_declined", error_message: "Your card was declined.", occurred_at: "2026-11-24T10:01:00Z" },
      { attempt_id: "b1", tenant_id: B, event: "failed", stage: "provider", error_class: "x", error_code: "x", error_message: "x", occurred_at: "2026-11-24T10:01:00Z" },
    ],
    tenants: [{ id: A, plan: "pro" }, { id: B, plan: "free" }],
    tier_definitions: [{ tier_name: "pro", analytics_retention_days: 90 }, { tier_name: "free", analytics_retention_days: 7 }],
    payment_attempts: [
      { attempt_id: "a1", tenant_id: A, mode: "live", state: "failed", stage: "provider", provider: "stripe", started_at: "2026-11-24T10:00:00Z" },
      { attempt_id: "a3", tenant_id: A, mode: "live", state: "granted", stage: null, provider: "razorpay", started_at: "2026-11-24T11:00:00Z" },
      { attempt_id: "a5", tenant_id: A, mode: "live", state: "failed", stage: "server", provider: "stripe", started_at: "2026-11-25T01:00:00Z" },
      { attempt_id: "b1", tenant_id: B, mode: "live", state: "failed", stage: "provider", provider: "stripe", started_at: "2026-11-24T10:00:00Z" },
    ],
    paywall_events: [
      { name: "paycraft_paywall_view", tenant_id: A, mode: "live", user_ref: "u1", device_ref: "d1", country: "IN", provider: null, occurred_at: "2026-11-24T09:00:00Z", attempt_id: null },
      { name: "paycraft_paywall_view", tenant_id: A, mode: "live", user_ref: "u2", device_ref: "d2", country: "US", provider: null, occurred_at: "2026-11-24T09:00:00Z", attempt_id: null },
      { name: "paycraft_checkout_start", tenant_id: A, mode: "live", user_ref: "u1", device_ref: "d1", country: "IN", provider: "stripe", occurred_at: "2026-11-24T09:05:00Z", attempt_id: "a1" },
      { name: "paycraft_paywall_view", tenant_id: B, mode: "live", user_ref: "x", device_ref: "x", country: "IN", provider: null, occurred_at: "2026-11-24T09:00:00Z", attempt_id: null },
    ],
  })
}

const url = (path: string, q: Record<string, string> = {}) => {
  const u = new URL(path, "https://paycraft.test")
  // A tenant named in the URL must be ignored — the caller's authentication already resolved it.
  u.searchParams.set("tenant_id", B)
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v)
  return u
}

describe("GET /v1/attempts", () => {
  it("lists only the authenticated tenant's attempts, newest first, with paging", async () => {
    const { client, calls } = await seed()
    const res = await listAttemptsResponse(client, A, url("/api/v1/attempts"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.map((r: { attempt_id: string }) => r.attempt_id).sort()).toEqual(["a1", "a2", "a3", "a4"])
    expect(body.pagination).toEqual({ limit: 50, offset: 0, total: 4, has_more: false })
    expect(calls[0].filters).toContain(`eq:tenant_id=${A}`)
  })

  it("filters by state / provider / country / window and never returns buyer identity", async () => {
    const { client } = await seed()
    const res = await listAttemptsResponse(client, A, url("/api/v1/attempts", {
      state: "failed", provider: "stripe", country: "in", since: "2026-11-24", until: "2026-11-25",
    }))
    const body = await res.json()
    expect(body.data.map((r: { attempt_id: string }) => r.attempt_id)).toEqual(["a1"])
    for (const r of body.data) {
      expect(r).not.toHaveProperty("user_ref")
      expect(r).not.toHaveProperty("provider_session_id")
    }
    expect(body.data[0].country).toBe("IN")
  })

  it("finds a buyer's attempts by email through the hash, without the email reaching the query", async () => {
    const { client, calls } = await seed()
    const body = await (await listAttemptsResponse(client, A, url("/api/v1/attempts", { user: BUYER }))).json()
    expect(body.data.map((r: { attempt_id: string }) => r.attempt_id)).toEqual(["a1"])
    expect(calls[0].filters.join(" ")).not.toContain(BUYER)
  })

  it.each([
    [{ state: "exploded" }, "invalid_state"],
    [{ stage: "moon" }, "invalid_stage"],
    [{ correlation: "maybe" }, "invalid_correlation"],
    [{ country: "IND" }, "invalid_country"],
    [{ since: "yesterday-ish" }, "invalid_window"],
    [{ user: "not-an-email" }, "invalid_user"],
    [{ mode: "prod" }, "invalid_mode"],
  ])("refuses %j with 400 %s instead of answering a different question", async (q, code) => {
    const { client } = await seed()
    const res = await listAttemptsResponse(client, A, url("/api/v1/attempts", q as Record<string, string>))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe(code)
  })
})

describe("GET /v1/attempts/{id}", () => {
  it("returns the attempt by attempt_id with its own timeline only", async () => {
    const { client } = await seed()
    const res = await attemptResponse(client, A, "a1")
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.attempt_id).toBe("a1")
    expect(body.events.map((e: { event: string }) => e.event)).toEqual(["started", "failed"])
    expect(body).not.toHaveProperty("user_ref")
  })

  it("resolves a row UUID too", async () => {
    const { client } = await seed()
    const body = await (await attemptResponse(client, A, "aaaaaaaa-0000-4000-8000-000000000002")).json()
    expect(body.attempt_id).toBe("a2")
  })

  it("404s another tenant's attempt — by attempt_id and by row id", async () => {
    const { client } = await seed()
    expect((await attemptResponse(client, A, "b1")).status).toBe(404)
    expect((await attemptResponse(client, A, "bbbbbbbb-0000-4000-8000-000000000001")).status).toBe(404)
  })

  it("400s an id that is missing or could not be an attempt id", async () => {
    const { client } = await seed()
    expect((await attemptResponse(client, A, undefined)).status).toBe(400)
    expect((await attemptResponse(client, A, "../webhooks")).status).toBe(400)
  })
})

describe("GET /v1/payment-health", () => {
  it("aggregates the tenant's window and reports the window it used", async () => {
    const { client } = await seed()
    const res = await paymentHealthResponse(client, A, url("/api/v1/payment-health", { since: "2026-11-24", until: "2026-11-25" }), NOW)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.mode).toBe("live")
    expect(body.window).toEqual({
      since: "2026-11-24T00:00:00.000Z", until: "2026-11-25T00:00:00.000Z", capped: false, retention_days: 90,
    })
    // a5 started after `until`; b1 is tenant-B — neither counts.
    expect(body.totals).toMatchObject({ attempts: 2, failed: 1, granted: 1 })
    expect(body.byProvider.find((b: { key: string }) => b.key === "stripe")).toEqual({ key: "stripe", total: 1, failed: 1, rate: 1 })
  })

  it("caps a window older than the plan's retention and says so", async () => {
    const { client } = await seed()
    const body = await (await paymentHealthResponse(client, B, url("/api/v1/payment-health", { since: "2026-01-01" }), NOW)).json()
    expect(body.window.capped).toBe(true)
    expect(body.window.retention_days).toBe(7)
    expect(body.window.since).toBe("2026-11-18T12:00:00.000Z")
  })

  it("400s an empty window", async () => {
    const { client } = await seed()
    const res = await paymentHealthResponse(client, A, url("/api/v1/payment-health", { since: "2026-11-25", until: "2026-11-24" }), NOW)
    expect(res.status).toBe(400)
  })
})

describe("GET /v1/funnel", () => {
  it("counts the tenant's distinct buyers per stage with country / provider splits", async () => {
    const { client } = await seed()
    const body = await (await funnelResponse(client, A, url("/api/v1/funnel", { since: "2026-11-24", until: "2026-11-25" }), NOW)).json()
    expect(body.stages.map((s: { users: number }) => s.users)).toEqual([2, 0, 1, 0])
    expect(body.by_country.find((r: { key: string }) => r.key === "IN")).toEqual({ key: "IN", viewers: 1, checkouts: 1, payers: 0 })
    expect(JSON.stringify(body)).not.toMatch(/"u1"|"d1"/)
  })
})

describe("window helpers", () => {
  it("defaults to the last 30 days ending now", () => {
    expect(parseWindow(new URLSearchParams(), NOW)).toEqual({
      since: "2026-10-26T12:00:00.000Z", until: "2026-11-25T12:00:00.000Z",
    })
  })

  it("never lets a capped window invert", () => {
    const w = clampWindow({ since: "2026-01-01T00:00:00.000Z", until: "2026-01-02T00:00:00.000Z" }, 7, NOW)
    expect(w.since <= w.until).toBe(true)
    expect(w.capped).toBe(true)
  })
})
