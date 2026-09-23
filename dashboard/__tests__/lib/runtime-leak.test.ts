/**
 * Drives the REAL handlers through their failure paths and reads what they actually send.
 *
 * WHY A SOURCE SCAN IS NOT ENOUGH
 * `guards.ts` reads source text, so it sees a literal like
 * `fail(500, "…", "SUPABASE_SERVICE_ROLE_KEY is not set")`. It is blind to a leak ASSEMBLED at
 * runtime from a value the code never names — proven by reintroducing
 * `` detail: `missing: ${missing.join(", ")}` `` and watching the scan stay green.
 *
 * The same blindness covered a live one: five endpoints passed `error.message` from Postgres
 * straight to the caller. A Postgres message carries schema names, constraint names and ROW
 * VALUES — `Key (email)=(someone@example.com) already exists` hands over a customer email. No
 * source scan can see that, because the string is built by the database.
 *
 * So this test renders the failure. It calls the handler, awaits the body, and asserts on the
 * bytes. `security-audit.sh` does the same against production; this catches it at PR time instead,
 * which is the difference between preventing a leak and noticing one.
 */

const FORBIDDEN =
  /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE|SERVICE_ROLE_KEY|DATABASE_URL|CLOUDFLARE_API_TOKEN|postgres(ql)?:\/\/|eyJ[A-Za-z0-9_-]{20}/

/** Things a real Postgres error has contained in this project. */
const HOSTILE_DB_ERROR = {
  code: "23505",
  message:
    'duplicate key value violates unique constraint "subscriptions_email_key" ' +
    "Key (email)=(a.customer@example.com) already exists. " +
    "connection: postgresql://postgres.abcdefgh:s3cr3t@aws-1.pooler.supabase.com:6543/postgres",
}

async function bodyOf(res: Response | { failed: Response }): Promise<string> {
  const r = "failed" in (res as any) ? (res as any).failed : (res as Response)
  return await r.text()
}

describe("/api/health — a missing variable must not be named to the caller", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })

  it("reports a count, and the rendered body names nothing", async () => {
    // Force the exact condition that made the old code leak.
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    jest.resetModules()

    const mod = await import("@/app/api/health/route")
    const text = await bodyOf(await mod.GET())

    expect(text).not.toMatch(FORBIDDEN)
    // And it still says something useful — silence would be its own bug.
    expect(text).toMatch(/required variable/)
  })
})

describe("requireApiKey — the misconfiguration 500 is reachable unauthenticated", () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })

  it("renders no infrastructure name", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    jest.resetModules()

    const mod = await import("@/lib/api-key-auth")
    const res = await mod.requireApiKey(
      new Request("https://api.paycraft.test/v1/readiness", {
        headers: { authorization: "Bearer pcsk_" + "a".repeat(64) },
      }),
      "readiness:read",
    )
    expect(await bodyOf(res as any)).not.toMatch(FORBIDDEN)
  })
})

describe("database errors never reach a caller", () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value"
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
    jest.resetModules()
  })

  it("queryFailed renders a stable code, not the driver's message", async () => {
    const { queryFailed } = await import("@/lib/api-security")
    const text = await bodyOf(queryFailed("test", HOSTILE_DB_ERROR))

    // The parts that must not survive: the customer's email, the connection string, the constraint.
    expect(text).not.toMatch(FORBIDDEN)
    expect(text).not.toContain("a.customer@example.com")
    expect(text).not.toContain("subscriptions_email_key")
    expect(text).not.toContain("duplicate key")
    // The part that must: something the client can branch on.
    expect(JSON.parse(text).error).toBe("query_failed")
  })

  it("a list endpoint returning a driver error leaks none of it", async () => {
    jest.resetModules()
    jest.doMock("@supabase/supabase-js", () => ({
      createClient: () => ({
        rpc: (fn: string) =>
          fn === "tenant_api_key_verify"
            ? Promise.resolve({
                data: [{ tenant_id: "t-1", key_id: "k-1", scopes: ["products:read"] }],
                error: null,
              })
            : Promise.resolve({ data: true, error: null }),
        from: () => ({
          select: () => ({
            eq: () => ({
              range: () => ({
                order: () => Promise.resolve({ data: null, error: HOSTILE_DB_ERROR, count: null }),
              }),
            }),
          }),
        }),
      }),
    }))

    const { listResource } = await import("@/lib/api-v1-helpers")
    const res = await listResource(
      new Request("https://api.paycraft.test/v1/products", {
        headers: { authorization: "Bearer pcsk_" + "b".repeat(64) },
      }),
      "products:read",
      { table: "tenant_products", columns: "id", orderBy: { column: "created_at" } },
    )

    const text = await bodyOf(res as any)
    expect(text).not.toContain("a.customer@example.com")
    expect(text).not.toContain("postgresql://")
    expect(text).not.toMatch(FORBIDDEN)
  })
})
