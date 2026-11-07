/**
 * DELETE /api/account-tokens — revoking an account-scoped pcsk_ key must actually revoke it.
 *
 * The route used to run a direct `UPDATE tenant_api_keys SET revoked_at …` with the signed-in user's
 * client. That table has RLS with a SELECT-only policy, so the update matched zero rows, raised no
 * error, and the route still answered {revoked: true} — the token stayed live (confirmed against
 * production 2026-11-07). It now goes through tenant_api_key_revoke (migration 175), which checks
 * ownership itself and audits. The mocked client exposes ONLY rpc(): any direct table write fails.
 */

const rpc = jest.fn()
let user: { id: string } | null = { id: "u-1" }

jest.mock("@/lib/supabase-server", () => ({
  createClient: () => ({ rpc, auth: { getUser: async () => ({ data: { user } }) } }),
}))

import { DELETE } from "@/app/api/account-tokens/route"

const del = (id?: string) =>
  DELETE(new Request(`https://paycraft.test/api/account-tokens${id ? `?id=${id}` : ""}`, { method: "DELETE" }))

beforeEach(() => {
  rpc.mockReset()
  user = { id: "u-1" }
})

describe("DELETE /api/account-tokens", () => {
  it("revokes through the tenant_api_key_revoke RPC, not a direct table update", async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const res = await del("key-1")
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("tenant_api_key_revoke", { p_id: "key-1" })
    expect((await res.json()).revoked).toBe(true)
  })

  it("never claims success when the RPC refuses", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "forbidden" } })
    const res = await del("someone-elses")
    expect(res.status).toBe(403)
    expect((await res.json()).revoked).toBeUndefined()
  })

  it("maps an unknown key to 404", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "unknown_key" } })
    expect((await del("nope")).status).toBe(404)
  })

  it("requires an id and a signed-in user", async () => {
    expect((await del()).status).toBe(400)
    user = null
    expect((await del("key-1")).status).toBe(401)
    expect(rpc).not.toHaveBeenCalled()
  })
})
