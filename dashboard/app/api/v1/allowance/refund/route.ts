import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"

export const dynamic = "force-dynamic"

/**
 * POST /v1/allowance/refund — give back one metered use because the consumer's server failed to
 * deliver it (e.g. a ReelExport export whose render failed). Body: `{ idempotency_key }` — the key the
 * spend was made with. Refunding twice returns `refunded: false` and changes nothing.
 *
 * Server-to-server only: needs the `allowance:refund` scope, which a browser never holds. A client
 * that could claim refunds could mint free uses.
 */
export async function POST(req: Request) {
  return withApiKey(req, "allowance:refund", async (ctx) => {
    const body = (await req.json().catch(() => null)) as { idempotency_key?: unknown } | null
    const key = typeof body?.idempotency_key === "string" ? body.idempotency_key.trim() : ""
    if (!key || key.length > 200) return NextResponse.json({ error: "invalid_idempotency_key" }, { status: 400 })
    const { data, error } = await ctx.admin.rpc("allowance_refund", { p_tenant_id: ctx.tenantId, p_idempotency_key: key })
    if (error) return queryFailed("v1/allowance/refund", error) as NextResponse
    const refunded = data === true
    if (refunded) await auditApiAction(ctx, "allowance.refund", `allowance-spend:${key}`)
    return NextResponse.json({ refunded })
  })
}
