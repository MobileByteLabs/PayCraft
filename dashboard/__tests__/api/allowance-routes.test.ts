/** /v1/allowance (configure) and /v1/allowance/refund — scopes, validation, and the RPCs they call. */
const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
let refundAnswer: boolean = true
let demanded: string[] = []

jest.mock("@/lib/api-v1-helpers", () => ({
  withApiKey: async (_req: Request, scope: string, fn: (ctx: unknown) => Promise<Response>) => {
    demanded.push(scope)
    return fn({
      tenantId: "t-1",
      admin: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args })
          return { data: fn === "allowance_refund" ? refundAnswer : null, error: null }
        },
      },
    })
  },
}))
jest.mock("@/lib/api-key-auth", () => ({ auditApiAction: jest.fn(async () => undefined) }))

import { PUT } from "@/app/api/v1/allowance/route"
import { POST } from "@/app/api/v1/allowance/refund/route"

const req = (method: string, body: unknown) => new Request("https://paycraft.test/api/v1/allowance", { method, body: JSON.stringify(body) })

beforeEach(() => {
  calls.length = 0
  demanded = []
  refundAnswer = true
})

describe("PUT /v1/allowance", () => {
  it("configures the allowance for the key's tenant with products:write", async () => {
    const res = await PUT(req("PUT", { sku: "full-edit", free_per_month: 5, credit_skus: ["edits-10"] }))
    expect(res.status).toBe(200)
    expect(demanded).toEqual(["products:write"])
    expect(calls).toEqual([{ fn: "allowance_configure", args: { p_tenant_id: "t-1", p_sku: "full-edit", p_free_per_month: 5, p_credit_skus: ["edits-10"] } }])
  })

  it("sets a Pro monthly grant of units when pro_per_month is given (migration 195)", async () => {
    const res = await PUT(req("PUT", { sku: "credits", free_per_month: 0, credit_skus: ["credits"], pro_per_month: 300 }))
    expect(res.status).toBe(200)
    expect(calls).toEqual([{ fn: "allowance_configure", args: { p_tenant_id: "t-1", p_sku: "credits", p_free_per_month: 0, p_credit_skus: ["credits"], p_pro_per_month: 300 } }])
    expect(((await res.json()) as { pro_per_month: number }).pro_per_month).toBe(300)
  })

  it("sets per-plan monthly grants when plan_grants is given (migration 196)", async () => {
    const grants = { "plus-monthly": 100, "max5-monthly": 1500, "max20-monthly": 6000 }
    const res = await PUT(req("PUT", { sku: "credits", free_per_month: 0, credit_skus: ["credits"], pro_per_month: 300, plan_grants: grants }))
    expect(res.status).toBe(200)
    expect(calls).toEqual([
      { fn: "allowance_configure", args: { p_tenant_id: "t-1", p_sku: "credits", p_free_per_month: 0, p_credit_skus: ["credits"], p_pro_per_month: 300 } },
      { fn: "allowance_set_plan_grants", args: { p_tenant_id: "t-1", p_sku: "credits", p_plan_grants: grants } },
    ])
    expect(((await res.json()) as { plan_grants: unknown }).plan_grants).toEqual(grants)
  })

  it.each([
    [{ sku: "credits", free_per_month: 0, plan_grants: { "plus-monthly": -1 } }, "invalid_plan_grants"],
    [{ sku: "credits", free_per_month: 0, plan_grants: { "Not A Sku": 10 } }, "invalid_plan_grants"],
    [{ sku: "credits", free_per_month: 0, plan_grants: [100] }, "invalid_plan_grants"],
    [{ sku: "credits", free_per_month: 0, pro_per_month: -5 }, "invalid_pro_per_month"],
    [{ sku: "Bad SKU", free_per_month: 5 }, "invalid_sku"],
    [{ sku: "full-edit", free_per_month: -1 }, "invalid_free_per_month"],
    [{ sku: "full-edit", free_per_month: 2.5 }, "invalid_free_per_month"],
    [{ sku: "full-edit", free_per_month: 5, credit_skus: ["OK NOT"] }, "invalid_credit_sku"],
  ])("refuses %j", async (body, error) => {
    const res = await PUT(req("PUT", body))
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe(error)
    expect(calls).toHaveLength(0)
  })
})

describe("POST /v1/allowance/refund", () => {
  it("needs the allowance:refund scope and refunds by idempotency key", async () => {
    const res = await POST(req("POST", { idempotency_key: "export-123" }))
    expect(demanded).toEqual(["allowance:refund"])
    expect(await res.json()).toEqual({ refunded: true })
    expect(calls).toEqual([{ fn: "allowance_refund", args: { p_tenant_id: "t-1", p_idempotency_key: "export-123" } }])
  })

  it("reports a second refund as not refunded", async () => {
    refundAnswer = false
    expect(await (await POST(req("POST", { idempotency_key: "export-123" }))).json()).toEqual({ refunded: false })
  })

  it("refuses a missing key", async () => {
    expect((await POST(req("POST", {}))).status).toBe(400)
    expect(calls).toHaveLength(0)
  })
})
