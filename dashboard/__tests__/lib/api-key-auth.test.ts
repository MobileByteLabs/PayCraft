/**
 * Authentication tests for the management API.
 *
 * These assert the properties that make a bearer-credential system safe rather than merely
 * functional. The one that matters most is the last block: the tenant comes from the KEY. If that
 * ever regresses, every valid key becomes a key to every tenant, and no other test here would fail.
 */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value"

const rpc = jest.fn()
jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ rpc }),
}))

import { requireApiKey, isFailure, type ApiKeyContext } from "@/lib/api-key-auth"
import { takesTenantFromRequest } from "../support/guards"

const VALID_KEY = "pcsk_" + "a".repeat(64)
const TENANT = "11111111-1111-1111-1111-111111111111"

/** Wire the two RPCs a successful call makes: verify, then the rate-limit check. */
function mockVerify(row: unknown, allowed: boolean | null = true) {
  rpc.mockReset()
  rpc.mockImplementation((fn: string) => {
    if (fn === "tenant_api_key_verify") return Promise.resolve({ data: row ? [row] : [], error: null })
    if (fn === "rate_limit_check") return Promise.resolve({ data: allowed, error: null })
    return Promise.resolve({ data: null, error: null })
  })
}

function req(headers: Record<string, string> = {}) {
  return new Request("https://paycraft.test/api/v1/readiness", { headers })
}

async function statusOf(r: Awaited<ReturnType<typeof requireApiKey>>) {
  return isFailure(r) ? r.failed.status : 200
}

describe("requireApiKey — rejection", () => {
  beforeEach(() => mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["readiness:read"] }))

  it("401s with no Authorization header", async () => {
    expect(await statusOf(await requireApiKey(req(), "readiness:read"))).toBe(401)
  })

  it("401s on a non-Bearer scheme", async () => {
    const r = await requireApiKey(req({ authorization: `Basic ${VALID_KEY}` }), "readiness:read")
    expect(await statusOf(r)).toBe(401)
  })

  it("401s on a wrong-prefix token WITHOUT querying the database", async () => {
    // The cheap shape check exists so a scanner spraying bearer tokens cannot generate query load.
    const r = await requireApiKey(req({ authorization: "Bearer sk_live_nope" }), "readiness:read")
    expect(await statusOf(r)).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("401s when verify returns zero rows (unknown, revoked and expired are indistinguishable)", async () => {
    mockVerify(null)
    const r = await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "readiness:read")
    expect(await statusOf(r)).toBe(401)
    if (isFailure(r)) expect(await r.failed.json()).toEqual({ error: "invalid_api_key" })
  })

  it("sends WWW-Authenticate on a 401 so a client knows how to authenticate", async () => {
    const r = await requireApiKey(req(), "readiness:read")
    if (isFailure(r)) expect(r.failed.headers.get("WWW-Authenticate")).toMatch(/Bearer/)
  })
})

describe("requireApiKey — scope", () => {
  it("403s (not 401) when the key is valid but lacks the scope", async () => {
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["readiness:read"] })
    const r = await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "products:sync")
    // 401 would invite a client to retry with the same key forever.
    expect(await statusOf(r)).toBe(403)
  })

  it("a read-only key cannot reach the bulk-write scope", async () => {
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["readiness:read", "products:read"] })
    const r = await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "products:sync")
    expect(await statusOf(r)).toBe(403)
  })

  it("passes when the exact scope is present", async () => {
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["products:sync"] })
    const r = await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "products:sync")
    expect(isFailure(r)).toBe(false)
  })

  it("treats a missing scopes array as no permissions, never as all", async () => {
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: null })
    const r = await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "readiness:read")
    expect(await statusOf(r)).toBe(403)
  })
})

describe("requireApiKey — rate limiting", () => {
  it("429s when the token bucket is empty", async () => {
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["readiness:read"] }, false)
    const r = await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "readiness:read")
    expect(await statusOf(r)).toBe(429)
  })

  it("does not rate-limit on a null bucket result (fail open on limiter trouble, not closed)", async () => {
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["readiness:read"] }, null)
    const r = await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "readiness:read")
    expect(isFailure(r)).toBe(false)
  })
})

describe("requireApiKey — tenant identity", () => {
  it("takes the tenant from the KEY, never from the request", async () => {
    // The property the whole design rests on. `requireApiKey` is given a request that names a
    // different tenant every way a caller could try; the context must still carry the key's tenant.
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["products:sync"] })
    const attacker = "22222222-2222-2222-2222-222222222222"
    const r = await requireApiKey(
      new Request(`https://paycraft.test/api/v1/sync?tenant_id=${attacker}`, {
        method: "POST",
        headers: { authorization: `Bearer ${VALID_KEY}`, "x-tenant-id": attacker },
        body: JSON.stringify({ tenant_id: attacker }),
      }),
      "products:sync",
    )
    expect(isFailure(r)).toBe(false)
    expect((r as ApiKeyContext).tenantId).toBe(TENANT)
    expect((r as ApiKeyContext).tenantId).not.toBe(attacker)
  })

  it("scopes the rate-limit bucket to the key's tenant", async () => {
    mockVerify({ tenant_id: TENANT, key_id: "k1", scopes: ["readiness:read"] })
    await requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "readiness:read")
    const call = rpc.mock.calls.find((c) => c[0] === "rate_limit_check")
    expect(call?.[1]).toMatchObject({ p_tenant_id: TENANT, p_bucket_name: "management_api" })
  })
})

describe("requireApiKey — misconfiguration", () => {
  it("does NOT name our infrastructure in a body an anonymous caller can read", async () => {
    const saved = process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    jest.resetModules()
    const mod = await import("@/lib/api-key-auth")
    const r = await mod.requireApiKey(req({ authorization: `Bearer ${VALID_KEY}` }), "readiness:read")
    expect(mod.isFailure(r)).toBe(true)
    if (mod.isFailure(r)) {
      expect(r.failed.status).toBe(500)
      // This 500 is reachable WITHOUT authenticating. Naming the variable here told any anonymous
      // caller which infrastructure we run on; the operator gets the name via console.error, the
      // internet gets the fact. The earlier version of this test asserted the opposite — it was
      // written before that reachability was noticed.
      const body = await r.failed.json()
      expect(body.detail).not.toMatch(/SUPABASE|SERVICE_ROLE|NEXT_PUBLIC/)
      expect(body.error).toBe("server_misconfigured")
    }
    process.env.SUPABASE_SERVICE_ROLE_KEY = saved
  })
})

/**
 * Source-level guard on the ROUTES.
 *
 * The identity test above passes trivially: `requireApiKey` never parses a request body, so it
 * *cannot* take a tenant from one. The actual danger is a route that authenticates correctly and
 * then drains `body.tenant_id` anyway — which no unit test of the auth helper would ever catch.
 *
 * This scans the v1 routes for that mistake directly, and enumerates them from disk so a route
 * added next month is covered without anyone remembering to add it here.
 */
describe("v1 routes — tenant is never taken from the request", () => {
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const V1 = path.join(__dirname, "..", "..", "app", "api", "v1")

  function routes(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) routes(p, out)
      else if (e.name === "route.ts") out.push(p)
    }
    return out
  }

  const all = routes(V1).map((f) => ({ rel: path.relative(V1, f), src: fs.readFileSync(f, "utf8") }))

  // A route may opt out of authentication only by SAYING SO. An explicit marker is the difference
  // between "this endpoint is public on purpose" and "someone forgot requireApiKey" — which read
  // identically to a reviewer, and identically to this test until the marker existed.
  const files = all.filter((f) => !f.src.includes("@public-endpoint"))
  const publicFiles = all.filter((f) => f.src.includes("@public-endpoint"))

  it("finds the v1 routes (an empty sweep would pass everything below)", () => {
    expect(files.length).toBeGreaterThanOrEqual(2)
  })

  it.each(publicFiles.map((f) => [f.rel, f]))(
    "%s is public, so it must touch NO tenant data",
    (_r, f: any) => {
      // The exemption covers authentication, not data access. A public route that queried anything
      // would be an unauthenticated read of a tenant's records, which is strictly worse than the
      // missing auth check this marker waives.
      expect(f.src).not.toMatch(/ctx\.admin|createClient|supabase|\.rpc\(|\.from\(/)
      // And that is the WHOLE property for a public route. An earlier version also banned reading a
      // tenant from the request, which is the right rule for an AUTHENTICATED route — there, a
      // substituted tenant id decides whose data is returned. Here nothing is returned, so there is
      // nothing to substitute, and the rule only produced false positives on the portal's own prose
      // ("No endpoint takes a tenant id — in a body, a query or a header"). A test that fails on the
      // documentation teaches the next author to delete the documentation.
    },
  )

  it.each(files.map((f) => [f.rel, f]))("%s never reads a tenant id from the request", (_r, f: any) => {
    // Shared predicate, proven in guard-predicates.test.ts to flag the cast form
    // `(body as any).tenant_id` that an inline regex here originally missed, and to ignore the
    // correct call that mentions ctx.tenantId and body on the same line.
    const offending = f.src.split("\n").filter(takesTenantFromRequest)
    expect(offending).toEqual([])
  })

  it.each(files.map((f) => [f.rel, f]))("%s passes ctx.tenantId into every helper", (_r, f: any) => {
    // The positive half. A route could avoid every banned spelling and still hand a drain the wrong
    // tenant; this asserts the argument that actually reaches the work is the key's.
    for (const call of f.src.match(/runSyncDrain\([^)]*\)/g) ?? []) {
      expect(call).toMatch(/ctx\.tenantId/)
    }
    for (const call of f.src.match(/p_tenant_id:\s*[^,\n]+/g) ?? []) {
      expect(call).toMatch(/ctx\.tenantId/)
    }
  })

  it.each(files.map((f) => [f.rel, f]))("%s authenticates before doing anything", (_r, f: any) => {
    // Either directly, or through a helper that does it — `listResource` and `withApiKey` both call
    // requireApiKey and return its failure unchanged.
    const direct = /requireApiKey\(/.test(f.src) && /isFailure\(/.test(f.src)
    const viaHelper = /\b(listResource|withApiKey)\(/.test(f.src)
    expect(direct || viaHelper).toBe(true)
  })

  it.each(files.map((f) => [f.rel, f]))("%s scopes its query to the key's tenant", (_r, f: any) => {
    // A route either names ctx.tenantId itself or delegates to a helper that applies the filter
    // centrally. The helper's own guarantee is asserted separately below — without that, this
    // branch would let a route opt out of tenant scoping just by importing something.
    const direct = /ctx\.tenantId/.test(f.src)
    const viaHelper = /\blistResource\(/.test(f.src)
    expect(direct || viaHelper).toBe(true)
  })
})


/**
 * The helper that every list endpoint delegates its tenant scoping to.
 *
 * This is load-bearing: the route-level test above accepts "delegates to listResource" as proof of
 * scoping, so if the helper ever stopped filtering, eleven routes would start returning every
 * tenant's rows and every one of those tests would still pass.
 */
describe("listResource — tenant scoping is centralised, so assert it here", () => {
  const fs2 = require("fs") as typeof import("fs")
  const path2 = require("path") as typeof import("path")
  const src = fs2.readFileSync(path2.join(__dirname, "..", "..", "lib", "api-v1-helpers.ts"), "utf8")

  it("filters by the key's tenant", () => {
    expect(src).toMatch(/\.eq\("tenant_id",\s*ctx\.tenantId\)/)
  })

  it("never takes a tenant from the request", () => {
    const offending = src
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => !l.startsWith("//") && !l.startsWith("*"))
      .map((l: string) => l.split("ctx.tenantId").join(""))
      .filter((l: string) => /tenant/i.test(l))
      .filter((l: string) => /\bbody\b|searchParams|req\.|request\.|headers/i.test(l))
    expect(offending).toEqual([])
  })

  it("caps the page size instead of trusting the caller", () => {
    expect(src).toMatch(/MAX_LIMIT/)
    expect(src).toMatch(/Math\.min/)
  })

  it("selects explicit columns rather than a wildcard", () => {
    // `tenants` holds api_key_live and webhook_secret_live in columns adjacent to the safe ones.
    expect(src).not.toMatch(/\.select\(["'`]\*/)
  })
})
