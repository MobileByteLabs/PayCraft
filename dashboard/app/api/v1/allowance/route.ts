import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"

export const dynamic = "force-dynamic"

const SKU = /^[a-z0-9][a-z0-9-]{1,63}$/

/**
 * PUT /v1/allowance — set a metered action's monthly free allowance (migration 189).
 * Body: `{ sku, free_per_month, credit_skus? }`. `credit_skus` are consumable balances that pay for a
 * use once the free ones run out, tried in order (e.g. ReelExport: `full-edit`, 5, `["edits-10"]`).
 * Optional `pro_per_month` (migration 195): Pro gets that many units a month instead of unmetered use
 * (e.g. ReelExport credits: `credits`, 0, `["credits"]`, 300). Optional `plan_grants` (migration 196):
 * `{ "<plan sku>": units }` — a member on that plan gets its grant instead of `pro_per_month`
 * (e.g. `{ "plus-monthly": 100, "max5-monthly": 1500 }`); `null` clears it.
 */
export async function PUT(req: Request) {
  return withApiKey(req, "products:write", async (ctx) => {
    const body = (await req.json().catch(() => null)) as { sku?: unknown; free_per_month?: unknown; credit_skus?: unknown; pro_per_month?: unknown; plan_grants?: unknown } | null
    const sku = typeof body?.sku === "string" ? body.sku : ""
    const free = Number(body?.free_per_month)
    const credits = Array.isArray(body?.credit_skus) ? body!.credit_skus.filter((s): s is string => typeof s === "string") : []
    if (!SKU.test(sku)) return NextResponse.json({ error: "invalid_sku" }, { status: 400 })
    if (!Number.isInteger(free) || free < 0 || free > 10_000) return NextResponse.json({ error: "invalid_free_per_month" }, { status: 400 })
    if (credits.some((s) => !SKU.test(s))) return NextResponse.json({ error: "invalid_credit_sku" }, { status: 400 })
    const hasPro = body?.pro_per_month !== undefined
    const pro = Number(body?.pro_per_month)
    if (hasPro && (!Number.isInteger(pro) || pro < 0 || pro > 1_000_000)) return NextResponse.json({ error: "invalid_pro_per_month" }, { status: 400 })
    const hasGrants = body?.plan_grants !== undefined
    const grants = body?.plan_grants ?? null
    const grantsOk = grants === null || (typeof grants === "object" && !Array.isArray(grants) &&
      Object.entries(grants as Record<string, unknown>).every(([k, v]) => SKU.test(k) && Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000))
    if (hasGrants && !grantsOk) return NextResponse.json({ error: "invalid_plan_grants" }, { status: 400 })
    const { error } = await ctx.admin.rpc("allowance_configure", {
      p_tenant_id: ctx.tenantId,
      p_sku: sku,
      p_free_per_month: free,
      p_credit_skus: credits,
      ...(hasPro ? { p_pro_per_month: pro } : {}),
    })
    if (error) return queryFailed("v1/allowance", error) as NextResponse
    if (hasGrants) {
      const { error: gErr } = await ctx.admin.rpc("allowance_set_plan_grants", { p_tenant_id: ctx.tenantId, p_sku: sku, p_plan_grants: grants })
      if (gErr) return queryFailed("v1/allowance", gErr) as NextResponse
    }
    const result = { free_per_month: free, credit_skus: credits, ...(hasPro ? { pro_per_month: pro } : {}), ...(hasGrants ? { plan_grants: grants } : {}) }
    await auditApiAction(ctx, "allowance.configure", `allowance:${sku}`, result)
    return NextResponse.json({ sku, ...result })
  })
}
