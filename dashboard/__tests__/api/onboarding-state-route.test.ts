/**
 * /api/onboarding/state — which app it reads, and what statuses it can record.
 *
 * 3a: GET used to read `tenants ORDER BY created_at DESC LIMIT 1` — the account's NEWEST app — no
 * matter which app the caller had selected. An owner reconciling reels-downloader read Affirmly's
 * steps. The fixture below makes the newest app a DIFFERENT one from the selected one, so the old
 * query answers wrong and the test fails on it.
 *
 * 3b: a re-verified step whose claim is false must be recorded `failed` (with the observed failure)
 * before it is healed. The old route only knew passed/blocked.
 */

const USER = "u-1"
const SELECTED = "aaaaaaaa-0000-0000-0000-000000000001" // reels-downloader, chosen in the app switcher
const OTHER = "aaaaaaaa-0000-0000-0000-000000000002" //    another app the user administers
const NEWEST = "aaaaaaaa-0000-0000-0000-000000000007" //   Affirmly — created last, NOT selected
const FOREIGN = "bbbbbbbb-0000-0000-0000-000000000009" //  someone else's app

let cookie: string | undefined
let upserts: Array<Record<string, unknown>>

jest.mock("next/headers", () => ({
  cookies: () => ({ get: (n: string) => (n === "paycraft_active_app_id" && cookie ? { value: cookie } : undefined) }),
}))

/** A query builder that remembers its filters and answers from them. */
function from(table: string) {
  const f: Record<string, unknown> = {}
  const q: any = {
    select: () => q,
    eq: (c: string, v: unknown) => ((f[c] = v), q),
    order: () => q,
    limit: () => q,
    upsert: (row: Record<string, unknown>) => (upserts.push({ table, ...row }), Promise.resolve({ error: null })),
    maybeSingle: async () => {
      if (table === "tenants") return { data: f.id ? { id: f.id, name: `app ${f.id}` } : null }
      if (table === "onboarding_app_state") return { data: { current_step: "A5", steps: [{ id: "A5", for: f.tenant_id }] } }
      if (table === "onboarding_customer_state") return { data: null }
      return { data: null }
    },
    // The OLD route awaited `.order().limit(1)` directly: answer it with the newest app.
    then: (res: (v: unknown) => unknown) =>
      res({ data: table === "tenants" ? [{ id: NEWEST, name: "Affirmly" }] : [], error: null }),
  }
  return q
}

jest.mock("@/lib/supabase-server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    rpc: async (name: string) =>
      name === "tenant_admins_list_for_user"
        ? { data: [{ tenant_id: OTHER }, { tenant_id: SELECTED }, { tenant_id: NEWEST }], error: null }
        : { data: null, error: null },
    from,
  }),
}))

import { GET, PATCH } from "@/app/api/onboarding/state/route"

const get = (q = "") => GET(new Request(`https://paycraft.test/api/onboarding/state${q}`))
const patch = (body: unknown) =>
  PATCH(new Request("https://paycraft.test/api/onboarding/state", { method: "PATCH", body: JSON.stringify(body) }))

beforeEach(() => {
  cookie = undefined
  upserts = []
})

describe("GET resolves the SELECTED app, not the newest (3a)", () => {
  it("honours the paycraft_active_app_id cookie", async () => {
    cookie = SELECTED
    const body = await (await get()).json()
    expect(body.tenant?.id).toBe(SELECTED)
    expect(body.tenant_id).toBe(SELECTED)
    expect(body.resolved_from).toBe("cookie")
    expect(body.app.steps[0].for).toBe(SELECTED)
  })

  it("an explicit ?tenant_id= wins over the cookie", async () => {
    cookie = SELECTED
    const body = await (await get(`?tenant_id=${OTHER}`)).json()
    expect(body.tenant_id).toBe(OTHER)
    expect(body.resolved_from).toBe("query")
  })

  it("?tenant_id= naming an app the user does not administer is 403, never a fallback", async () => {
    const res = await get(`?tenant_id=${FOREIGN}`)
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("tenant_not_reachable")
  })

  it("a stale cookie for a non-member app falls back to the first membership", async () => {
    cookie = FOREIGN
    const body = await (await get()).json()
    expect(body.tenant_id).toBe(OTHER)
    expect(body.resolved_from).toBe("default")
  })
})

describe("PATCH can record a FAILED step (3b)", () => {
  it("accepts failed with evidence and stores it", async () => {
    const res = await patch({ tenant_id: SELECTED, step_id: "A5", status: "failed", evidence: { app_store: "MISSING_METADATA" } })
    expect(res.status).toBe(200)
    const step = (upserts[0].steps as any[]).find((s) => s.id === "A5")
    expect(step).toMatchObject({ status: "failed", evidence: { app_store: "MISSING_METADATA" } })
    expect(upserts[0].current_step).toBe("A5")
  })

  it("refuses failed without evidence", async () => {
    const res = await patch({ tenant_id: SELECTED, step_id: "A5", status: "failed" })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("evidence_required")
    expect(upserts).toHaveLength(0)
  })

  it("passed and blocked rules are unchanged", async () => {
    expect((await patch({ tenant_id: SELECTED, step_id: "A1", status: "passed" })).status).toBe(400)
    expect((await patch({ tenant_id: SELECTED, step_id: "A7", status: "blocked" })).status).toBe(400)
    expect((await patch({ tenant_id: SELECTED, step_id: "A7", status: "blocked", blocked_reason: "nope" })).status).toBe(400)
    expect((await patch({ tenant_id: SELECTED, step_id: "A7", status: "bogus", evidence: {} })).status).toBe(400)
    expect(
      (await patch({ tenant_id: SELECTED, step_id: "A7", status: "blocked", blocked_reason: "pending-device-verify" })).status,
    ).toBe(200)
  })
})
