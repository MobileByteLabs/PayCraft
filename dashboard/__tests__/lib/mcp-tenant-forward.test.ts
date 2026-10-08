/**
 * MCP tools must forward `tenant_id` to the route they call.
 *
 * WHY THIS TEST EXISTS. An ACCOUNT-scoped token (migration 150) reaches several apps, so the API
 * answers 400 `tenant_required` unless the request names one. The MCP dispatcher carries that name
 * on the origin and `call()` copies it onto the request URL.
 *
 * The first implementation appended it to the origin string and relied on `new URL(path, origin)`
 * to keep it — which it does NOT: that form preserves only the base's ORIGIN and silently drops
 * its query. Every account-scoped MCP call would have 400'd with the argument apparently supplied,
 * and nothing would have pointed at the URL construction. The behaviour is cheap to assert and
 * invisible to review, which is exactly the kind worth pinning.
 *
 * Asserted through a real tool rather than against `call()` directly, because `call()` is module
 * private — and testing the exported surface is what actually protects callers.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value"

/** Capture the Request each handler receives, and answer 200 without touching a database. */
const seen: { url: string | null } = { url: null }
const capture = (req: Request) => {
  seen.url = req.url
  return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
}

jest.mock("@/app/api/v1/readiness/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/sync/route", () => ({
  GET: (r: Request) => capture(r),
  POST: (r: Request) => capture(r),
}))
jest.mock("@/app/api/v1/products/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/products/[id]/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/products/[id]/sync/route", () => ({ POST: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/providers/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/subscribers/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/entitlements/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/coupons/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/paywall/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/webhooks/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/audit/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/tenant/route", () => ({ GET: (r: Request) => capture(r) }))
jest.mock("@/app/api/v1/sync/events/route", () => ({ GET: (r: Request) => capture(r) }))

import { MCP_TOOLS } from "@/lib/mcp-tools"

const TENANT = "11111111-1111-1111-1111-111111111111"
const AUTH = "Bearer pcsk_" + "a".repeat(64)
const ORIGIN = "https://paycraft.test"
/** What the dispatcher builds when a tool call names a tenant. */
const ORIGIN_WITH_TENANT = `${ORIGIN}/?tenant_id=${TENANT}`

beforeEach(() => {
  seen.url = null
})

describe("MCP tools forward tenant_id to the underlying route", () => {
  it("a tenant named on the origin reaches the request URL", async () => {
    const tool = MCP_TOOLS.find((t) => t.name === "paycraft_readiness")!
    await tool.invoke({ tenant_id: TENANT }, AUTH, ORIGIN_WITH_TENANT)
    expect(seen.url).not.toBeNull()
    expect(new URL(seen.url!).searchParams.get("tenant_id")).toBe(TENANT)
  })

  it("the path is still correct — carrying a query must not corrupt the route", async () => {
    const tool = MCP_TOOLS.find((t) => t.name === "paycraft_readiness")!
    await tool.invoke({ tenant_id: TENANT }, AUTH, ORIGIN_WITH_TENANT)
    expect(new URL(seen.url!).pathname).toBe("/api/v1/readiness")
  })

  it("no tenant on the origin leaves the URL clean (app-scoped tokens never need one)", async () => {
    const tool = MCP_TOOLS.find((t) => t.name === "paycraft_readiness")!
    await tool.invoke({}, AUTH, ORIGIN)
    expect(new URL(seen.url!).searchParams.get("tenant_id")).toBeNull()
  })

  it("a tool's OWN query params survive alongside the tenant", async () => {
    // The merge order matters: origin params are copied first, then the tool's own. A tool that
    // paginates must keep doing so when an account token names an app.
    const tool = MCP_TOOLS.find((t) => t.name === "paycraft_products")!
    await tool.invoke({ tenant_id: TENANT, limit: 5 }, AUTH, ORIGIN_WITH_TENANT)
    const q = new URL(seen.url!).searchParams
    expect(q.get("tenant_id")).toBe(TENANT)
    expect(q.get("limit")).toBe("5")
  })

  it("EVERY tool advertises tenant_id, so none silently 400s for an account token", async () => {
    // A tool added later that forgets the argument fails here rather than in production, where the
    // symptom is an unexplained 400 from a call whose arguments looked complete.
    const missing = MCP_TOOLS.filter((t) => {
      const props = (t.inputSchema as any)?.properties ?? {}
      return !("tenant_id" in props)
    }).map((t) => t.name)
    expect(missing).toEqual([])
  })
})
