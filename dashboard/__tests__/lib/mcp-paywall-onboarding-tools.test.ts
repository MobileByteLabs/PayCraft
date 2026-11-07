/**
 * The seven MCP tools that replace the cookie-only paywall / onboarding / store-readiness paths.
 *
 * The /idea-paycraft runtime treats the MCP server as its ONLY sanctioned write path, yet applying a
 * template, saving/publishing the draft, editing copy, reading/writing onboarding state and asking
 * store readiness all needed a hand-rolled browser session. These tests pin:
 *   • the exact tool names the framework runtime references, and the scope each one ENFORCES
 *     (asserted by invoking the tool and recording what the route demanded — not by reading prose);
 *   • the copy merge: a one-field edit must not reset the other columns (tenant_paywall_upsert
 *     overwrites every column);
 *   • onboarding writes reuse the dashboard's validator (failed needs evidence; blocked needs a reason).
 */
import { NextResponse } from "next/server"

const TENANT = "11111111-1111-1111-1111-111111111111"
const AUTH = "Bearer pcsk_" + "a".repeat(64)
const ORIGIN = `https://paycraft.test/?tenant_id=${TENANT}`

let scopes: string[]
let runHandler: boolean
let rpcCalls: Array<{ name: string; args: any }>
let upserts: Array<Record<string, unknown>>
let audited: Array<{ action: string; after?: any }>
let paywallRow: Record<string, unknown> | null
let readinessArgs: unknown[] | null
const admin = {
  rpc: async (name: string, args: any) => {
    rpcCalls.push({ name, args })
    return { data: name === "tenant_paywall_publish" ? 7 : { applied: true }, error: null }
  },
  from: (table: string) => {
    const f: Record<string, unknown> = {}
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => ((f[c] = v), q),
      maybeSingle: async () => {
        if (table === "tenant_paywall") return { data: paywallRow, error: null }
        if (table === "onboarding_app_state") return { data: { current_step: "A4", steps: [{ id: "A4", status: "passed", evidence: { x: 1 } }] } }
        if (table === "tenant_api_keys") return { data: { owner_user_id: "owner-1" } }
        if (table === "onboarding_customer_state") return { data: { current_step: "C3", steps: [] } }
        return { data: null }
      },
      upsert: async (row: Record<string, unknown>) => (upserts.push({ table, ...row }), { error: null }),
    }
    return q
  },
}

jest.mock("@/lib/api-v1-helpers", () => ({
  __esModule: true,
  ...jest.requireActual("@/lib/api-v1-helpers"),
  withApiKey: async (_req: Request, scope: string, fn: (ctx: unknown) => Promise<Response>) => {
    scopes.push(scope)
    if (!runHandler) return NextResponse.json({ ok: true })
    return fn({ tenantId: TENANT, keyId: "k-1", scopes: [scope], accountScoped: true, reachableTenantIds: [TENANT], admin })
  },
}))
jest.mock("@/lib/api-key-auth", () => ({
  __esModule: true,
  ...jest.requireActual("@/lib/api-key-auth"),
  auditApiAction: async (_c: unknown, action: string, _r: string, after?: unknown) => {
    audited.push({ action, after })
  },
}))
jest.mock("@/lib/store-readiness", () => ({
  __esModule: true,
  computeStoreReadiness: async (...a: unknown[]) => {
    readinessArgs = a
    return { applicable: true, ready: false, stores: {}, products: [] }
  },
}))

import { MCP_TOOLS } from "@/lib/mcp-tools"
import { mergePaywallCopy } from "@/lib/paywall-copy"

const tool = (n: string) => {
  const t = MCP_TOOLS.find((x) => x.name === n)
  if (!t) throw new Error(`missing tool ${n}`)
  return t
}

beforeEach(() => {
  scopes = []
  runHandler = true
  rpcCalls = []
  upserts = []
  audited = []
  paywallRow = null
  readinessArgs = null
})

const EXPECTED: Record<string, { scope: string; args: Record<string, unknown> }> = {
  paycraft_paywall_apply_template: { scope: "paywall:write", args: { slug: "minimal" } },
  paycraft_paywall_save_workflow: { scope: "paywall:write", args: { workflow: { schema_version: 2 } } },
  paycraft_paywall_update_copy: { scope: "paywall:write", args: { fields: { hero_title: "x" } } },
  paycraft_paywall_publish: { scope: "paywall:write", args: {} },
  paycraft_onboarding_state: { scope: "onboarding:read", args: {} },
  paycraft_onboarding_record: { scope: "onboarding:write", args: { step_id: "A5", status: "passed", evidence: { a: 1 } } },
  paycraft_store_readiness: { scope: "products:read", args: {} },
}

describe("tool registry", () => {
  it.each(Object.entries(EXPECTED))("%s exists, takes tenant_id, and its route enforces the right scope", async (name, e) => {
    const t = tool(name)
    expect((t.inputSchema as any).properties).toHaveProperty("tenant_id")
    expect(t.description).toContain(`Requires ${e.scope}`)
    runHandler = false
    const res = await t.invoke({ tenant_id: TENANT, ...e.args }, AUTH, ORIGIN)
    expect(res.status).toBe(200)
    expect(scopes).toEqual([e.scope])
  })

  it("record's status/blocked_reason enums are the shared validator's lists, not copies", () => {
    const { STATUSES, BLOCKED_REASONS } = jest.requireActual("@/lib/onboarding-state")
    const p = (tool("paycraft_onboarding_record").inputSchema as any).properties
    expect(p.status.enum).toEqual([...STATUSES])
    expect(p.blocked_reason.enum).toEqual([...BLOCKED_REASONS])
  })
})

describe("paywall copy merge", () => {
  const current = {
    id: "row-id",
    tenant_id: TENANT,
    hero_title: "Old title",
    value_props: [{ title: "HD downloads" }],
    trial_disclosure_body: "custom disclosure",
    settings_manage_label: "Manage",
    updated_at: "2026-01-01",
  }

  it("overlays only the named field and keeps every other column", async () => {
    paywallRow = current
    const res = await tool("paycraft_paywall_update_copy").invoke(
      { tenant_id: TENANT, fields: { hero_title: "Go Pro" } },
      AUTH,
      ORIGIN,
    )
    expect(res.status).toBe(200)
    const call = rpcCalls.find((c) => c.name === "tenant_paywall_upsert")!
    expect(call.args.p_row).toMatchObject({
      tenant_id: TENANT,
      hero_title: "Go Pro",
      value_props: [{ title: "HD downloads" }],
      trial_disclosure_body: "custom disclosure",
      settings_manage_label: "Manage",
    })
    // Non-column metadata is not sent back into the upsert.
    expect(call.args.p_row).not.toHaveProperty("id")
    expect(call.args.p_row).not.toHaveProperty("updated_at")
    expect(audited[0]).toMatchObject({ action: "paywall.updated", after: { fields: ["hero_title"] } })
  })

  it("refuses unknown keys instead of dropping them", async () => {
    const res = await tool("paycraft_paywall_update_copy").invoke(
      { tenant_id: TENANT, fields: { hero_titel: "typo" } },
      AUTH,
      ORIGIN,
    )
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("unknown_fields")
    expect(rpcCalls).toHaveLength(0)
  })

  it("tenant_id cannot be smuggled in as a field", () => {
    const r = mergePaywallCopy(TENANT, current, { tenant_id: "other" })
    expect(r).toMatchObject({ error: "unknown_fields" })
  })
})

describe("paywall draft/publish", () => {
  it("apply_template calls the RPC for the resolved tenant and reports draft-only", async () => {
    const res = await tool("paycraft_paywall_apply_template").invoke({ tenant_id: TENANT, slug: "minimal", mode: "update" }, AUTH, ORIGIN)
    expect(await res.json()).toMatchObject({ ok: true, published: false })
    expect(rpcCalls[0]).toEqual({ name: "tenant_paywall_apply_template", args: { p_tenant: TENANT, p_slug: "minimal", p_mode: "update" } })
  })

  it("save_workflow refuses a non-object and saves an object", async () => {
    expect((await tool("paycraft_paywall_save_workflow").invoke({ tenant_id: TENANT, workflow: "x" }, AUTH, ORIGIN)).status).toBe(400)
    await tool("paycraft_paywall_save_workflow").invoke({ tenant_id: TENANT, workflow: { steps: [] } }, AUTH, ORIGIN)
    expect(rpcCalls[0]).toEqual({ name: "tenant_paywall_workflow_upsert", args: { p_tenant: TENANT, p_workflow: { steps: [] } } })
  })

  it("publish calls tenant_paywall_publish and audits", async () => {
    const body = await (await tool("paycraft_paywall_publish").invoke({ tenant_id: TENANT }, AUTH, ORIGIN)).json()
    expect(body).toMatchObject({ published: true, published_revision: 7 })
    expect(audited[0].action).toBe("paywall.published")
  })
})

describe("onboarding over the API", () => {
  it("state returns the app state plus the account owner's customer state", async () => {
    const body = await (await tool("paycraft_onboarding_state").invoke({ tenant_id: TENANT }, AUTH, ORIGIN)).json()
    expect(body.tenant_id).toBe(TENANT)
    expect(body.app.current_step).toBe("A4")
    expect(body.customer.current_step).toBe("C3")
  })

  it("record demotes a step to failed WITH evidence", async () => {
    const res = await tool("paycraft_onboarding_record").invoke(
      { tenant_id: TENANT, step_id: "A4", status: "failed", evidence: { ready: false } },
      AUTH,
      ORIGIN,
    )
    expect(res.status).toBe(200)
    expect(upserts[0]).toMatchObject({ table: "onboarding_app_state", tenant_id: TENANT, current_step: "A4" })
    expect((upserts[0].steps as any[]).find((s) => s.id === "A4")).toMatchObject({ status: "failed", evidence: { ready: false } })
    expect(audited[0]).toMatchObject({ action: "onboarding.step_recorded", after: { status: "failed" } })
  })

  it("record applies the shared validation", async () => {
    const r = tool("paycraft_onboarding_record")
    const bad = [
      { step_id: "A4", status: "failed" },
      { step_id: "A4", status: "passed" },
      { step_id: "A7", status: "blocked" },
      { step_id: "A7", status: "blocked", blocked_reason: "nope" },
      { step_id: "A7", status: "skipped", evidence: {} },
    ]
    for (const b of bad) {
      expect((await r.invoke({ tenant_id: TENANT, ...b }, AUTH, ORIGIN)).status).toBe(400)
    }
    expect(upserts).toHaveLength(0)
  })
})

describe("store readiness over the API", () => {
  it("runs the SAME implementation as the dashboard route, on the resolved tenant", async () => {
    const body = await (await tool("paycraft_store_readiness").invoke({ tenant_id: TENANT }, AUTH, ORIGIN)).json()
    expect(readinessArgs).toEqual([admin, TENANT])
    expect(body).toMatchObject({ tenant_id: TENANT, applicable: true, ready: false })
  })
})
