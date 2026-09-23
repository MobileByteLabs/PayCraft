import fs from "fs"
import path from "path"

/**
 * The Developer API key routes — create, list, revoke.
 *
 * These were built and deployed without ever being exercised: the page needs a logged-in session,
 * and every key in development was minted through the RPC directly. "Typechecks and deploys" is not
 * the same as "works", so this covers the logic a bug would actually live in.
 *
 * The UI on top is presentation over these three calls; its contract with them is asserted at the
 * end from source, since adding jsdom and React Testing Library to a node-only suite is a heavier
 * change than the risk warrants.
 */

const TENANT = "11111111-1111-1111-1111-111111111111"

const rpc = jest.fn()
const select = jest.fn()
const requireTenant = jest.fn()

jest.mock("@/lib/tenant", () => ({ requireTenant: () => requireTenant() }))
jest.mock("@/lib/supabase-server", () => ({
  createClient: () => ({
    rpc,
    from: () => ({
      select: (cols: string) => {
        select(cols)
        return {
          eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
        }
      },
    }),
  }),
}))

import { GET, POST, DELETE } from "@/app/api/developer-keys/route"

beforeEach(() => {
  rpc.mockReset()
  select.mockReset()
  requireTenant.mockReset()
  requireTenant.mockResolvedValue({ tenant: { id: TENANT } })
})

const post = (body: unknown) =>
  POST(
    new Request("https://paycraft.test/api/developer-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )

describe("POST — create", () => {
  it("mints a key and returns the plaintext exactly once", async () => {
    rpc.mockResolvedValue({
      data: [{ id: "key-1", api_key: "pcsk_" + "a".repeat(64), key_prefix: "pcsk_aaaaaaa…" }],
      error: null,
    })
    const res = await post({ name: "ci-pipeline", scopes: ["readiness:read"] })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.api_key).toMatch(/^pcsk_/)
    expect(rpc).toHaveBeenCalledWith("tenant_api_key_create", expect.objectContaining({
      p_tenant_id: TENANT,
      p_name: "ci-pipeline",
      p_scopes: ["readiness:read"],
    }))
  })

  it("takes the tenant from the session, never from the body", async () => {
    // The browser twin of the API's own rule. A posted tenant_id must not decide whose tenant gets
    // a new credential.
    rpc.mockResolvedValue({ data: [{ id: "k", api_key: "pcsk_x", key_prefix: "p" }], error: null })
    await post({ name: "n", scopes: ["readiness:read"], tenant_id: "22222222-2222-2222-2222-222222222222" })
    expect(rpc.mock.calls[0][1].p_tenant_id).toBe(TENANT)
  })

  it("refuses a nameless key", async () => {
    // The name is what the audit log shows beside everything the key does; an unnamed key is an
    // unattributable one.
    const res = await post({ name: "   ", scopes: ["readiness:read"] })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses a key with no scopes rather than defaulting to any", async () => {
    const res = await post({ name: "n", scopes: [] })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("drops scopes outside the closed vocabulary", async () => {
    rpc.mockResolvedValue({ data: [{ id: "k", api_key: "pcsk_x", key_prefix: "p" }], error: null })
    await post({ name: "n", scopes: ["readiness:read", "billing:drain_everything"] })
    expect(rpc.mock.calls[0][1].p_scopes).toEqual(["readiness:read"])
  })

  it("refuses when every requested scope was invalid", async () => {
    // Filtering must not silently produce an empty-scope key.
    const res = await post({ name: "n", scopes: ["totally:made-up"] })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("surfaces an RPC failure instead of pretending it worked", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } })
    const res = await post({ name: "n", scopes: ["readiness:read"] })
    expect(res.status).toBe(500)
  })
})

describe("GET — list", () => {
  it("returns metadata only, never the hash", async () => {
    // There is no endpoint that can return a key. One that leaked the hash would hand an attacker
    // the one value the whole design keeps out of the database in plaintext.
    const res = await GET()
    expect(res.status).toBe(200)
    const cols = select.mock.calls[0][0] as string
    expect(cols).not.toMatch(/key_hash/)
    expect(cols).toMatch(/key_prefix/)
    expect(cols).toMatch(/revoked_at/)
    expect(cols).toMatch(/last_used_at/)
  })
})

describe("DELETE — revoke", () => {
  it("revokes by id", async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const res = await DELETE(new Request("https://paycraft.test/api/developer-keys?id=key-1", { method: "DELETE" }))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("tenant_api_key_revoke", { p_id: "key-1" })
  })

  it("requires an id", async () => {
    const res = await DELETE(new Request("https://paycraft.test/api/developer-keys", { method: "DELETE" }))
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("lets the RPC decide ownership rather than trusting the caller's id", async () => {
    // A forged id belonging to another tenant is refused inside tenant_api_key_revoke, which
    // re-checks membership. The route must therefore surface the error, not swallow it.
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } })
    const res = await DELETE(new Request("https://paycraft.test/api/developer-keys?id=someone-elses", { method: "DELETE" }))
    expect(res.status).toBe(500)
  })
})

describe("the UI's contract with these routes", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "components", "settings", "developer-api-client.tsx"),
    "utf8",
  )

  it("shows the plaintext once and never re-fetches it", () => {
    expect(src).toMatch(/setFreshKey\(data\.api_key\)/)
    // A refetch would be pointless (the server has only a hash) and would imply it were possible.
    expect(src).not.toMatch(/api_key.*keys\.map|keys\.map.*api_key/)
  })

  it("sends both a name and explicit scopes", () => {
    expect(src).toMatch(/body: JSON\.stringify\(\{ name, scopes: selected \}\)/)
  })

  it("confirms before revoking", () => {
    expect(src).toMatch(/confirm\(/)
  })

  it("marks the write scope visibly", () => {
    // products:sync can bulk-write to live payment providers; it must not look like the read scopes.
    expect(src).toMatch(/writes live/)
  })
})
