/**
 * Account-level provider connections — the contract the dashboard depends on.
 *
 * The behaviour lives in SQL (migration 103) and is proven against a real database; these pin the
 * HTTP shape the UI talks to, so a route rename or a changed payload fails here rather than in a
 * browser after deploy.
 */
import { POST as attach } from "@/app/api/provider-accounts/attach/route"
import { GET as list, PATCH as setDefault, POST as save } from "@/app/api/provider-accounts/route"

const rpc = jest.fn()
jest.mock("@/lib/supabase-server", () => ({
  createClient: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
}))
jest.mock("@/lib/tenant", () => ({
  requireTenant: async () => ({ tenant: { id: "t1" }, userId: "u1" }),
}))

const req = (url: string, body?: unknown) =>
  new Request(url, body === undefined ? undefined : {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }) as never

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: null, error: null })
})

describe("provider connections API", () => {
  it("lists connections for one provider", async () => {
    rpc.mockResolvedValueOnce({ data: [{ id: "a1", label: "Play A", is_default: true }], error: null })
    const res = await list(req("https://x/api/provider-accounts?provider=google_play"))
    expect(rpc).toHaveBeenCalledWith("provider_accounts_list", { p_provider: "google_play" })
    expect((await res.json()).connections).toHaveLength(1)
  })

  it("saves without a credential so a rename never re-pastes a secret", async () => {
    rpc.mockResolvedValueOnce({ data: "acct-1", error: null })
    const res = await save(req("https://x/api/provider-accounts", {
      id: "acct-1", provider: "google_play", label: "Renamed",
    }))
    expect(res.status).toBe(200)
    const [, args] = rpc.mock.calls[0]
    expect(args.p_credential).toBeNull()
    expect(args.p_label).toBe("Renamed")
  })

  it("never records a credential in the audit trail", async () => {
    rpc.mockResolvedValueOnce({ data: "acct-1", error: null })
    await save(req("https://x/api/provider-accounts", {
      provider: "google_play", label: "New", credential: '{"private_key":"-----BEGIN"}',
    }))
    const audit = rpc.mock.calls.find((c) => c[0] === "audit_log_emit")
    expect(JSON.stringify(audit?.[1] ?? {})).not.toContain("BEGIN")
    expect(JSON.stringify(audit?.[1] ?? {})).not.toContain("private_key")
  })

  it("rejects a save with no label — an unlabelled connection cannot be told apart in a picker", async () => {
    const res = await save(req("https://x/api/provider-accounts", { provider: "google_play" }))
    expect(res.status).toBe(400)
  })

  it("attaching null means FOLLOW THE DEFAULT, not 'no billing'", async () => {
    await attach(req("https://x/api/provider-accounts/attach", { provider: "google_play", accountId: null }))
    const [, args] = rpc.mock.calls[0]
    expect(args).toMatchObject({ p_tenant: "t1", p_provider: "google_play", p_account_id: null })
  })

  it("changing the default goes through the RPC that enforces one default per provider", async () => {
    const res = await setDefault(req("https://x/api/provider-accounts", { id: "acct-2" }))
    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith("provider_accounts_set_default", { p_id: "acct-2" })
  })

  it("surfaces the database's own refusal rather than a generic 500", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "package_name/bundle_id are per-app; set them on the app, not the connection" },
    })
    const res = await save(req("https://x/api/provider-accounts", {
      provider: "app_store", label: "X", config: { bundle_id: "com.x" },
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("per-app")
  })
})
