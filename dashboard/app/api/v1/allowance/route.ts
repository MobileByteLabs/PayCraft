import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"

export const dynamic = "force-dynamic"

const SKU = /^[a-z0-9][a-z0-9-]{1,63}$/

/**
 * PUT /v1/allowance — set a metered action's monthly free allowance (migration 189).
 * Body: `{ sku, free_per_month, credit_skus? }`. `credit_skus` are consumable balances that pay for a
 * use once the free ones run out, tried in order (e.g. Kreatwiz: `kw-full-edit`, 5, `["edits-10"]`).
 */
export async function PUT(req: Request) {
  return withApiKey(req, "products:write", async (ctx) => {
    const body = (await req.json().catch(() => null)) as { sku?: unknown; free_per_month?: unknown; credit_skus?: unknown } | null
    const sku = typeof body?.sku === "string" ? body.sku : ""
    const free = Number(body?.free_per_month)
    const credits = Array.isArray(body?.credit_skus) ? body!.credit_skus.filter((s): s is string => typeof s === "string") : []
    if (!SKU.test(sku)) return NextResponse.json({ error: "invalid_sku" }, { status: 400 })
    if (!Number.isInteger(free) || free < 0 || free > 10_000) return NextResponse.json({ error: "invalid_free_per_month" }, { status: 400 })
    if (credits.some((s) => !SKU.test(s))) return NextResponse.json({ error: "invalid_credit_sku" }, { status: 400 })
    const { error } = await ctx.admin.rpc("allowance_configure", {
      p_tenant_id: ctx.tenantId,
      p_sku: sku,
      p_free_per_month: free,
      p_credit_skus: credits,
    })
    if (error) return queryFailed("v1/allowance", error) as NextResponse
    await auditApiAction(ctx, "allowance.configure", `allowance:${sku}`, { free_per_month: free, credit_skus: credits })
    return NextResponse.json({ sku, free_per_month: free, credit_skus: credits })
  })
}
