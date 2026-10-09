/**
 * The v1 helpers must forward the requested tenant.
 *
 * `withApiKey` and `listResource` back 15 of the 17 v1 routes. Both called
 * `requireApiKey(req, scope)` with no third argument, so an ACCOUNT-scoped token authenticated
 * fine and then always got 400 `tenant_required`: it had no way to name an app. Only `readiness`
 * and `sync` — the two routes calling requireApiKey directly — worked, which is why the gap read
 * as "some tools are broken" instead of "one seam drops the argument".
 *
 * A unit test at this seam is the cheap one. The MCP-level test proves the dispatcher puts
 * tenant_id on the URL; nothing proved the helper then READ it.
 */
import { listResource, withApiKey } from "@/lib/api-v1-helpers"
import { NextResponse } from "next/server"

const TENANT = "11111111-1111-1111-1111-111111111111"
const calls: Array<string | undefined> = []

jest.mock("@/lib/api-key-auth", () => ({
  __esModule: true,
  // Record the third argument — the whole point of the test.
  requireApiKey: jest.fn(async (_req: Request, _scope: string, requested?: string) => {
    calls.push(requested)
    // Chainable stub: listResource builds a real query off ctx.admin, and this test is about the
    // argument it passed BEFORE that, not about the query.
    const q: Record<string, unknown> = {}
    for (const m of ["from", "select", "eq", "order", "range"]) q[m] = () => q
    ;(q as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ data: [], count: 0, error: null })
    return { tenantId: requested ?? TENANT, keyId: "k", scopes: [], accountScoped: true, reachableTenantIds: [TENANT], admin: q }
  }),
  requestedTenant: (req: Request) => new URL(req.url).searchParams.get("tenant_id") ?? undefined,
  isFailure: (v: unknown) => typeof v === "object" && v !== null && "failed" in (v as object),
}))

jest.mock("@/lib/api-security", () => ({
  __esModule: true,
  withSecurityHeaders: (r: unknown) => r,
  queryFailed: () => NextResponse.json({ error: "query_failed" }, { status: 500 }),
}))

beforeEach(() => { calls.length = 0 })

describe("v1 helpers forward the requested tenant", () => {
  it("withApiKey passes ?tenant_id through to requireApiKey", async () => {
    const req = new Request(`https://x.test/api/v1/paywall?tenant_id=${TENANT}`)
    await withApiKey(req, "paywall:read" as never, async () => NextResponse.json({ ok: true }))
    expect(calls).toEqual([TENANT])
  })

  it("listResource passes ?tenant_id through to requireApiKey", async () => {
    const req = new Request(`https://x.test/api/v1/products?tenant_id=${TENANT}`)
    await listResource(req, "products:read" as never, { table: "products", columns: "id" })
    expect(calls).toEqual([TENANT])
  })

  it("passes undefined when no tenant is named — the 400 must still be reachable", async () => {
    // An app-scoped caller names nothing and must keep working; the helper must not invent a value.
    await withApiKey(new Request("https://x.test/api/v1/paywall"), "paywall:read" as never,
      async () => NextResponse.json({ ok: true }))
    expect(calls).toEqual([undefined])
  })
})
