// /api/v1/analytics/findings (paycraft-ga4-analytics-audit sub-plan 05): how /idea-paycraft-analytics reads the open
// findings, records what it found and resolves what it fixed. Writes go through migration 216's RPCs; the tenant is
// always the caller's, and a finding id from another app changes nothing (404).
import { findingsListResponse, findingsResolveResponse, findingsUpsertResponse } from "@/lib/attempt-api"
import { fakeSupabase } from "../support/fake-supabase"

const T = "11111111-1111-1111-1111-111111111111"
const F1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"

function sb(rpcAnswer: unknown = true) {
  const calls: Array<[string, Record<string, unknown>]> = []
  const { client } = fakeSupabase({
    analytics_findings: [
      { id: F1, tenant_id: T, kind: "product_not_found", severity: "critical", title: "40 buyers could not buy", summary: "s", proposed_fix: "p", status: "open", fixed_note: null, source: "digest", window_start: "2026-11-16", window_end: "2026-11-22", created_at: "2026-11-23T09:00:00Z", evidence: {} },
      { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", tenant_id: "other", kind: "x", severity: "low", title: "other app", status: "open", created_at: "2026-11-23T09:00:00Z" },
    ],
  })
  const s = Object.assign(Object.create(client), {
    rpc: async (fn: string, args: Record<string, unknown>) => (calls.push([fn, args]), { data: rpcAnswer, error: null }),
  })
  return { s, calls }
}

const req = (body: unknown) => new Request("https://x/api/v1/analytics/findings", { method: "POST", body: JSON.stringify(body) })

describe("GET findings", () => {
  it("lists the caller's findings, open by default", async () => {
    const res = await findingsListResponse(sb().s, T, new URL("https://x/api/v1/analytics/findings"))
    const body = await res.json()
    expect(body.data.map((f: { id: string }) => f.id)).toEqual([F1])
    const all = await (await findingsListResponse(sb().s, T, new URL("https://x/api/v1/analytics/findings?status=all"))).json()
    expect(all.data).toHaveLength(1)
  })
})

describe("POST findings", () => {
  it("records a finding the command found, for the caller's tenant, source command", async () => {
    const { s, calls } = sb("new-id")
    const res = await findingsUpsertResponse(s, T, req({
      kind: "checkout_without_provider", severity: "high", title: "Checkouts carry no provider",
      summary: "97 of 97", proposed_fix: "Pass the lane's provider", window_start: "2026-11-18", window_end: "2026-11-25",
    }))
    expect(res.status).toBe(201)
    expect(calls[0][0]).toBe("analytics_finding_upsert")
    expect(calls[0][1]).toMatchObject({ p_tenant_id: T, p_kind: "checkout_without_provider", p_severity: "high", p_source: "command" })
  })

  it("refuses a malformed finding", async () => {
    for (const bad of [{ kind: "Bad Kind", severity: "high", title: "t", window_start: "2026-11-18", window_end: "2026-11-25" },
                       { kind: "k", severity: "urgent", title: "t", window_start: "2026-11-18", window_end: "2026-11-25" },
                       { kind: "k", severity: "low", title: "", window_start: "2026-11-18", window_end: "2026-11-25" },
                       { kind: "k", severity: "low", title: "t", window_start: "yesterday", window_end: "2026-11-25" }]) {
      expect((await findingsUpsertResponse(sb().s, T, req(bad))).status).toBe(400)
    }
  })
})

describe("PATCH findings", () => {
  it("resolves the caller's finding with what was done", async () => {
    const { s, calls } = sb(true)
    const res = await findingsResolveResponse(s, T, req({ id: F1, status: "fixed", note: "SDK reports not_from_play" }))
    expect(res.status).toBe(200)
    expect(calls[0]).toEqual(["analytics_finding_resolve", { p_tenant_id: T, p_id: F1, p_status: "fixed", p_note: "SDK reports not_from_play" }])
  })

  it("is a 404 when the id is not the caller's (the RPC changed nothing)", async () => {
    const res = await findingsResolveResponse(sb(false).s, T, req({ id: F1, status: "fixed", note: "n" }))
    expect(res.status).toBe(404)
  })

  it("needs a note saying what was done", async () => {
    expect((await findingsResolveResponse(sb().s, T, req({ id: F1, status: "fixed", note: "" }))).status).toBe(400)
  })
})
