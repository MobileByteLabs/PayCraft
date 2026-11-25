/**
 * The dashboard AI reads attempt facts through the SAME paycraft_* MCP tools an external agent calls
 * (paycraft-attempt-observability GOAL D13 / AC-17).
 *
 * The handler bodies (lib/attempt-api.ts) are replaced by recorders, so this suite pins the BRIDGE: which tool a
 * question reaches, how often, with which request URL, under which tenant — and that questions which are not
 * about attempts never touch those tools. The bodies themselves are pinned in attempt-api.test.ts.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value"

type Recorded = { fn: string; sb: unknown; tenantId: string; url?: string; id?: string }
const recorded: Recorded[] = []
const canned: { health: { status: number; body: unknown }; attempt: { status: number; body: unknown } } = {
  health: { status: 200, body: {} },
  attempt: { status: 200, body: {} },
}
const json = (r: { status: number; body: unknown }) =>
  new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } })

jest.mock("@/lib/attempt-api", () => ({
  paymentHealthResponse: async (sb: unknown, tenantId: string, url: URL) => {
    recorded.push({ fn: "paycraft_payment_health", sb, tenantId, url: url.toString() })
    return json(canned.health)
  },
  attemptResponse: async (sb: unknown, tenantId: string, id: string) => {
    recorded.push({ fn: "paycraft_attempt", sb, tenantId, id })
    return json(canned.attempt)
  },
  listAttemptsResponse: async (sb: unknown, tenantId: string, url: URL) => {
    recorded.push({ fn: "paycraft_attempts", sb, tenantId, url: url.toString() })
    return json({ status: 200, body: { data: [] } })
  },
  funnelResponse: async (sb: unknown, tenantId: string, url: URL) => {
    recorded.push({ fn: "paycraft_funnel", sb, tenantId, url: url.toString() })
    return json({ status: 200, body: {} })
  },
}))

const metricsCalls: string[] = []
jest.mock("@/lib/ai/metrics", () => ({
  loadMetrics: async (_sb: unknown, tenantId: string) => {
    metricsCalls.push(tenantId)
    return {
      mrrDollars: 1200, arpu: 12, active: 100, trial: 10, canceled: 5, churnRate: 0.04, trialToPaid: 0.3,
      annualShare: 0.2, webhookSuccess: 0.99, hasAnnualPlan: true, popularPlanSku: "pro-annual",
      primaryColor: "#4F46E5", valuePropsCount: 4, planCount: 3,
    }
  },
}))

import { answer } from "@/lib/ai/engine"

const TENANT = "11111111-1111-1111-1111-111111111111"
const OTHER = "22222222-2222-2222-2222-222222222222"
const NOW = new Date("2026-11-25T09:30:00Z")
const SESSION_CLIENT = { marker: "the signed-in member's client" } as never

const HEALTH = {
  mode: "live",
  window: { since: "2026-11-24T00:00:00.000Z", until: "2026-11-25T00:00:00.000Z", capped: false, retention_days: 90 },
  totals: { attempts: 120, granted: 78, failed: 16, paidNotGranted: 2, abandoned: 24, open: 0, grantRate: 0.65 },
  byStage: [{ key: "provider", total: 120, failed: 11, rate: 11 / 120 }, { key: "server", total: 120, failed: 5, rate: 5 / 120 }],
  byProvider: [{ key: "stripe", total: 60, failed: 15, rate: 0.25 }, { key: "razorpay", total: 60, failed: 3, rate: 0.05 }],
  byCountry: [{ key: "IN", total: 40, failed: 12, rate: 0.3 }, { key: "US", total: 80, failed: 6, rate: 0.075 }],
  abandonByStep: [
    { step: "plan_select", reached: 120, abandoned: 10, rate: 10 / 120 },
    { step: "checkout_open", reached: 90, abandoned: 14, rate: 14 / 90 },
    { step: "provider_result", reached: 80, abandoned: 0, rate: 0 },
  ],
  paidNotGranted: 2,
  nudge: { scheduled: 18, skippedNoPermission: 6, reach: 0.75 },
}

beforeEach(() => {
  recorded.length = 0
  metricsCalls.length = 0
  canned.health = { status: 200, body: HEALTH }
  canned.attempt = { status: 200, body: {} }
})

describe("a payment-failure question reads paycraft_payment_health", () => {
  it("'why did Stripe fail in India yesterday' invokes paycraft_payment_health exactly once, tenant on the URL", async () => {
    const out = await answer("Why did Stripe fail in India yesterday?", SESSION_CLIENT, TENANT, { now: NOW })
    expect(recorded.map((r) => r.fn)).toEqual(["paycraft_payment_health"])
    const call = recorded[0]
    expect(call.tenantId).toBe(TENANT)
    expect(call.sb).toBe(SESSION_CLIENT)
    const u = new URL(call.url!)
    expect(u.pathname).toBe("/api/v1/payment-health")
    expect(u.searchParams.getAll("tenant_id")).toEqual([TENANT])
    expect(u.searchParams.get("since")).toBe("2026-11-24T00:00:00.000Z")
    expect(u.searchParams.get("until")).toBe("2026-11-25T00:00:00.000Z")
    expect(u.searchParams.get("mode")).toBe("live")
    expect(out.proposals).toEqual([])
    expect(out.text).toContain("Stripe: 15 of 60 attempts failed (25.0%)")
    expect(out.text).toContain("India (IN): 12 of 40 attempts failed (30.0%)")
    expect(out.text).toContain("2 buyers were charged without getting access")
    expect(out.text).toContain("paycraft_attempts state=failed provider=stripe country=IN since=2026-11-24 until=2026-11-25")
    expect(metricsCalls).toEqual([])
  })

  it("reads in the dashboard's mode and never lets a question name another tenant", async () => {
    await answer(`Why did payments fail for tenant ${OTHER} in the last 3 days?`, SESSION_CLIENT, TENANT, { now: NOW, mode: "test" })
    expect(recorded).toHaveLength(1)
    const u = new URL(recorded[0].url!)
    expect(recorded[0].tenantId).toBe(TENANT)
    expect(u.searchParams.getAll("tenant_id")).toEqual([TENANT])
    expect(u.searchParams.get("mode")).toBe("test")
    expect(u.searchParams.get("since")).toBe("2026-11-22T09:30:00.000Z")
  })

  it("an ISO code in capitals is a country; the word 'in' is not", async () => {
    const out = await answer("Razorpay failures in US last 7 days", SESSION_CLIENT, TENANT, { now: NOW })
    expect(out.text).toContain("Razorpay: 3 of 60 attempts failed (5.0%)")
    expect(out.text).toContain("United States (US): 6 of 80 attempts failed (7.5%)")
  })

  it("a tool error is reported as a refusal to read, never as a healthy-looking answer", async () => {
    canned.health = { status: 500, body: { error: "query_failed" } }
    const out = await answer("Why did Stripe fail yesterday?", SESSION_CLIENT, TENANT, { now: NOW })
    expect(out.text).toMatch(/couldn't read payment health.*query_failed/)
    expect(out.text).not.toMatch(/attempts failed/)
  })
})

describe("an attempt id reads paycraft_attempt", () => {
  it("'explain attempt <id>' invokes paycraft_attempt once and renders the failing step and timeline", async () => {
    canned.attempt = {
      status: 200,
      body: {
        id: "aaaaaaaa-0000-4000-8000-000000000001", attempt_id: "1732492800000-9f3c2a1b", provider: "stripe",
        mode: "live", plan: "pro-monthly", state: "failed", correlation: "exact", match_rule: null, stage: "provider",
        error_class: "declined", error_code: "card_declined", error_message: "Your card was declined.",
        started_at: "2026-11-24T10:00:00Z", paid_at: null, granted_at: null, closed_at: "2026-11-24T10:01:00Z", country: "IN",
        events: [
          { occurred_at: "2026-11-24T10:00:00Z", event: "started", stage: "sdk", error_class: null, error_code: null, error_message: null },
          { occurred_at: "2026-11-24T10:01:00Z", event: "failed", stage: "provider", error_class: "declined", error_code: "card_declined", error_message: "Your card was declined." },
        ],
      },
    }
    const out = await answer("Explain attempt 1732492800000-9f3c2a1b please", SESSION_CLIENT, TENANT, { now: NOW })
    expect(recorded.map((r) => [r.fn, r.id, r.tenantId])).toEqual([["paycraft_attempt", "1732492800000-9f3c2a1b", TENANT]])
    expect(out.text).toContain("It failed at the Provider stage — declined / card_declined: Your card was declined.")
    expect(out.text).toContain("2026-11-24 10:00 UTC — Plan selected [SDK]")
  })

  it("an unknown attempt is a plain not-found, not an error", async () => {
    canned.attempt = { status: 404, body: { error: "not_found" } }
    const out = await answer("explain attempt 9f3c2a1b-0001", SESSION_CLIENT, TENANT, { now: NOW })
    expect(out.text).toContain("can't find attempt 9f3c2a1b-0001")
  })
})

describe("questions that are not about attempts never touch the attempt tools", () => {
  it.each([
    "How do I increase my MRR?",
    "What is a failed payment?",
    "How do I reduce failed payments?",
    "Why is my revenue flat?",
    "How do webhooks work?",
  ])("%s", async (q) => {
    await answer(q, SESSION_CLIENT, TENANT, { now: NOW })
    expect(recorded).toEqual([])
  })
})
