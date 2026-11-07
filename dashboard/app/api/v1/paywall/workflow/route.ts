import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
export const dynamic = "force-dynamic"

/**
 * PUT /v1/paywall/workflow — save the DRAFT tree.  Body: `{workflow}`.
 * Validation lives in `tenant_paywall_workflow_upsert`, so every writer gets the same rules.
 */
export async function PUT(req: Request) {
  return withApiKey(req, "paywall:write", async (ctx) => {
    const body = (await req.json().catch(() => ({}))) as { workflow?: unknown }
    if (!body.workflow || typeof body.workflow !== "object" || Array.isArray(body.workflow)) {
      return NextResponse.json({ error: "workflow object is required" }, { status: 400 })
    }
    const { data, error } = await ctx.admin.rpc("tenant_paywall_workflow_upsert", {
      p_tenant: ctx.tenantId,
      p_workflow: body.workflow,
    })
    // Validator messages ("unknown component type x") are the useful part — passed through.
    if (error) return NextResponse.json({ error: "workflow_invalid", detail: error.message }, { status: 400 })

    await auditApiAction(ctx, "paywall.workflow_saved", `tenant_paywall:tenant_id=${ctx.tenantId}`, { revision: data })
    return NextResponse.json({ ok: true, tenant_id: ctx.tenantId, revision: data, published: false })
  })
}

/**
 * POST /v1/paywall/workflow — PUBLISH the draft. The only call here that changes what a buyer sees;
 * a separate verb so publishing is never a side effect of saving.
 */
export async function POST(req: Request) {
  return withApiKey(req, "paywall:write", async (ctx) => {
    const { data, error } = await ctx.admin.rpc("tenant_paywall_publish", { p_tenant: ctx.tenantId })
    if (error) return NextResponse.json({ error: "publish_failed", detail: error.message }, { status: 400 })

    await auditApiAction(ctx, "paywall.published", `tenant_paywall:tenant_id=${ctx.tenantId}`, {
      published_revision: data,
    })
    return NextResponse.json({ ok: true, tenant_id: ctx.tenantId, published_revision: data, published: true })
  })
}
