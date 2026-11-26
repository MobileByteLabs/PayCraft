/**
 * The four attempt-observability MCP tools (paycraft-attempt-observability GOAL D13 / AC-17).
 *
 * Each tool is a thin adapter over a /api/v1 route handler, so what this suite pins is the ADAPTER:
 *   · every tool is registered with a title, a tenant_id argument and a closed input schema;
 *   · every filter an agent names reaches the route's query string, on the right path;
 *   · the tenant comes from the dispatcher's origin and only from there — a tool argument naming another
 *     app never reaches the URL, so the route's own requireApiKey check is the one that decides reach.
 * The routes' tenant scoping itself is pinned in __tests__/lib/attempt-api.test.ts.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value"

const seen: { url: string | null; method: string | null; auth: string | null; params: Record<string, string> | null; calls: number } = {
  url: null, method: null, auth: null, params: null, calls: 0,
}
const capture = (req: Request, ctx?: { params?: Record<string, string> }) => {
  seen.url = req.url
  seen.method = req.method
  seen.auth = req.headers.get("authorization")
  seen.params = ctx?.params ?? null
  seen.calls++
  return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }))
}
jest.mock("@/app/api/v1/attempts/route", () => ({ GET: (r: Request, c?: any) => capture(r, c) }))
jest.mock("@/app/api/v1/attempts/[id]/route", () => ({ GET: (r: Request, c?: any) => capture(r, c) }))
jest.mock("@/app/api/v1/payment-health/route", () => ({ GET: (r: Request, c?: any) => capture(r, c) }))
jest.mock("@/app/api/v1/funnel/route", () => ({ GET: (r: Request, c?: any) => capture(r, c) }))
jest.mock("@/app/api/v1/analytics/route", () => ({ GET: (r: Request, c?: any) => capture(r, c) }))

import { MCP_TOOLS } from "@/lib/mcp-tools"

const TENANT = "11111111-1111-1111-1111-111111111111"
const OTHER = "22222222-2222-2222-2222-222222222222"
const AUTH = "Bearer pcsk_" + "a".repeat(64)
const ORIGIN = `https://paycraft.test/?tenant_id=${TENANT}`
const NAMES = ["paycraft_attempts", "paycraft_attempt", "paycraft_payment_health", "paycraft_funnel", "paycraft_analytics"] as const

const tool = (name: string) => {
  const t = MCP_TOOLS.find((x) => x.name === name)
  if (!t) throw new Error(`${name} is not registered`)
  return t
}

beforeEach(() => {
  seen.url = null
  seen.method = null
  seen.auth = null
  seen.params = null
  seen.calls = 0
})

describe("attempt MCP tools — registration", () => {
  it.each(NAMES)("%s is registered with a title, a tenant_id argument and a closed schema", (name) => {
    const t = tool(name)
    expect(t.title.length).toBeGreaterThan(5)
    expect(t.description).toMatch(/subscribers:read/)
    expect(t.inputSchema).toHaveProperty("properties.tenant_id")
    expect(t.inputSchema).toHaveProperty("additionalProperties", false)
    expect(t.destructive).toBeUndefined()
  })

  it("paycraft_attempt requires the attempt id", () => {
    expect((tool("paycraft_attempt").inputSchema as { required?: string[] }).required).toEqual(["id"])
  })

  it("the list tool advertises exactly the filters its route reads", () => {
    const props = Object.keys((tool("paycraft_attempts").inputSchema as { properties: object }).properties).sort()
    expect(props).toEqual(
      ["correlation", "country", "limit", "mode", "offset", "provider", "since", "stage", "state", "tenant_id", "until", "user"].sort(),
    )
  })
})

describe("paycraft_attempts — query forwarding", () => {
  it("forwards state / stage / provider / country / window / correlation / paging and the tenant", async () => {
    await tool("paycraft_attempts").invoke(
      { state: "failed", stage: "provider", provider: "stripe", country: "IN", mode: "live",
        since: "2026-11-01", until: "2026-11-25", correlation: "exact", limit: 50, offset: 10 },
      AUTH, ORIGIN,
    )
    const u = new URL(seen.url!)
    expect(seen.method).toBe("GET")
    expect(u.pathname).toBe("/api/v1/attempts")
    expect(u.searchParams.get("tenant_id")).toBe(TENANT)
    expect(Object.fromEntries([...u.searchParams.entries()].filter(([k]) => k !== "tenant_id"))).toEqual({
      state: "failed", stage: "provider", provider: "stripe", country: "IN", mode: "live",
      since: "2026-11-01", until: "2026-11-25", correlation: "exact", limit: "50", offset: "10",
    })
  })

  it("an omitted filter stays off the URL rather than arriving as an empty value", async () => {
    await tool("paycraft_attempts").invoke({ state: "failed" }, AUTH, ORIGIN)
    const u = new URL(seen.url!)
    expect([...u.searchParams.keys()].sort()).toEqual(["state", "tenant_id"])
  })
})

describe("tenant isolation — the origin's tenant wins over any tenant_id argument", () => {
  it("paycraft_attempts never forwards another app named in its arguments", async () => {
    await tool("paycraft_attempts").invoke({ tenant_id: OTHER, state: "failed" }, AUTH, ORIGIN)
    expect(new URL(seen.url!).searchParams.getAll("tenant_id")).toEqual([TENANT])
  })

  it("paycraft_attempt addresses /api/v1/attempts/{id} with the id as a route param", async () => {
    await tool("paycraft_attempt").invoke({ id: "a-1", tenant_id: OTHER }, AUTH, ORIGIN)
    const u = new URL(seen.url!)
    expect(u.pathname).toBe("/api/v1/attempts/a-1")
    expect(seen.params).toEqual({ id: "a-1" })
    expect(u.searchParams.getAll("tenant_id")).toEqual([TENANT])
  })

  it("paycraft_attempt escapes an id so it cannot climb out of its path segment", async () => {
    await tool("paycraft_attempt").invoke({ id: "../webhooks" }, AUTH, ORIGIN)
    expect(new URL(seen.url!).pathname).toBe("/api/v1/attempts/..%2Fwebhooks")
  })

  it.each([
    ["paycraft_payment_health", "/api/v1/payment-health"],
    ["paycraft_funnel", "/api/v1/funnel"],
  ])("%s forwards its window + mode to %s under the origin's tenant only", async (name, path) => {
    await tool(name).invoke({ tenant_id: OTHER, since: "2026-11-24", until: "2026-11-25", mode: "test" }, AUTH, ORIGIN)
    const u = new URL(seen.url!)
    expect(u.pathname).toBe(path)
    expect(u.searchParams.getAll("tenant_id")).toEqual([TENANT])
    expect(u.searchParams.get("since")).toBe("2026-11-24")
    expect(u.searchParams.get("until")).toBe("2026-11-25")
    expect(u.searchParams.get("mode")).toBe("test")
  })

  it.each(NAMES)("%s carries the caller's own Authorization to exactly one handler call", async (name) => {
    await tool(name).invoke({ id: "a-1" }, AUTH, ORIGIN)
    expect(seen.calls).toBe(1)
    expect(seen.auth).toBe(AUTH)
  })

  it("an app-scoped caller (no tenant on the origin) sends no tenant at all", async () => {
    await tool("paycraft_payment_health").invoke({ tenant_id: OTHER }, AUTH, "https://paycraft.test")
    expect(new URL(seen.url!).searchParams.get("tenant_id")).toBeNull()
  })
})

describe("paycraft_analytics (paycraft-ga4-analytics-audit)", () => {
  it("forwards its days + filters to /api/v1/analytics under the origin's tenant only", async () => {
    await tool("paycraft_analytics").invoke(
      { tenant_id: OTHER, days: 7, platform: "android", country: "ID", app_version: "2.4.1", plan: "pro-annual", mode: "live" },
      AUTH,
      ORIGIN,
    )
    const u = new URL(seen.url!)
    expect(u.pathname).toBe("/api/v1/analytics")
    expect(u.searchParams.getAll("tenant_id")).toEqual([TENANT])
    expect(Object.fromEntries([...u.searchParams].filter(([k]) => k !== "tenant_id"))).toEqual({
      days: "7", platform: "android", country: "ID", app_version: "2.4.1", plan: "pro-annual", mode: "live",
    })
  })
})
