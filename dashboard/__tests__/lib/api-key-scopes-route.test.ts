import fs from "fs"
import path from "path"

/**
 * PATCH — edit an existing pcsk_ key's scopes in place (migration 174, api_key_set_scopes).
 *
 * Both key screens get the same verb: account tokens (/api/account-tokens) and app keys
 * (/api/developer-keys). The key value never changes, so nothing holding it needs re-provisioning.
 */

const TENANT = "11111111-1111-1111-1111-111111111111"
const rpc = jest.fn()
let user: { id: string } | null = { id: "u-1" }

jest.mock("@/lib/tenant", () => ({ requireTenant: async () => ({ tenant: { id: TENANT } }) }))
jest.mock("@/lib/supabase-server", () => ({
  createClient: () => ({ rpc, auth: { getUser: async () => ({ data: { user } }) } }),
}))

import * as accountTokens from "@/app/api/account-tokens/route"
import * as developerKeys from "@/app/api/developer-keys/route"

beforeEach(() => {
  rpc.mockReset()
  user = { id: "u-1" }
})

const routes = [
  { name: "account-tokens", mod: accountTokens as any, scope: "onboarding:write" },
  { name: "developer-keys", mod: developerKeys as any, scope: "products:sync" },
]

describe.each(routes)("PATCH /api/$name", ({ name, mod, scope }) => {
  const patch = (body: unknown) =>
    mod.PATCH(
      new Request(`https://paycraft.test/api/${name}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    )

  it("exists", () => {
    expect(typeof mod.PATCH).toBe("function")
  })

  it("replaces the scopes of the given key via api_key_set_scopes", async () => {
    rpc.mockResolvedValue({ data: ["readiness:read", scope], error: null })
    const res = await patch({ id: "key-1", scopes: ["readiness:read", scope] })
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("api_key_set_scopes", { p_id: "key-1", p_scopes: ["readiness:read", scope] })
    const body = await res.json()
    expect(body.scopes).toEqual(["readiness:read", scope])
    expect(body.api_key).toBeUndefined()
  })

  it("drops scopes outside the route's vocabulary, like POST", async () => {
    rpc.mockResolvedValue({ data: ["readiness:read"], error: null })
    await patch({ id: "key-1", scopes: ["readiness:read", "billing:drain_everything"] })
    expect(rpc.mock.calls[0][1].p_scopes).toEqual(["readiness:read"])
  })

  it("refuses when nothing valid is left after filtering", async () => {
    const res = await patch({ id: "key-1", scopes: ["totally:made-up"] })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it("requires an id", async () => {
    const res = await patch({ scopes: ["readiness:read"] })
    expect(res.status).toBe(400)
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["forbidden", 403],
    ["key_not_active", 409],
    ["scopes_required", 400],
    ["unknown_scope", 400],
    ["something exploded", 500],
  ])("maps RPC error %s to %i", async (message, status) => {
    rpc.mockResolvedValue({ data: null, error: { message } })
    const res = await patch({ id: "key-1", scopes: ["readiness:read"] })
    expect(res.status).toBe(status)
  })
})

it("account-tokens PATCH requires a session", async () => {
  user = null
  const res = await (accountTokens as any).PATCH(
    new Request("https://paycraft.test/api/account-tokens", {
      method: "PATCH",
      body: JSON.stringify({ id: "key-1", scopes: ["readiness:read"] }),
    }),
  )
  expect(res.status).toBe(401)
  expect(rpc).not.toHaveBeenCalled()
})

describe("the UI's contract with PATCH", () => {
  it.each(["account-tokens-client.tsx", "developer-api-client.tsx"])("%s edits scopes in place", (file) => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "components", "settings", file), "utf8")
    expect(src).toMatch(/method: "PATCH"/)
    expect(src).toMatch(/Edit scopes/)
    // The point of the feature: the existing key keeps working with its new scopes.
    expect(src).toMatch(/key value is unchanged/i)
  })
})
