import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { queryFailed } from "@/lib/api-security"
import { auditApiAction } from "@/lib/api-key-auth"
import { mergePaywallCopy } from "@/lib/paywall-copy"
export const dynamic = "force-dynamic"

/**
 * GET /v1/paywall — the paywall configuration the SDK renders from.
 *
 * Useful in CI as a snapshot: diff this between deploys and a paywall that changed without anyone
 * intending it shows up as a failing check rather than a customer complaint.
 */
export async function GET(req: Request) {
  return withApiKey(req, "paywall:read", async (ctx) => {
    const { data, error } = await ctx.admin
      .from("tenant_paywall")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle()

    if (error) return queryFailed("v1/paywall", error) as NextResponse
    if (!data) {
      return NextResponse.json(
        { error: "not_found", detail: "no paywall configured for this tenant" },
        { status: 404 },
      )
    }
    return NextResponse.json(data)
  })
}

/**
 * PATCH /v1/paywall — change named paywall copy fields, and nothing else.  Body: `{ fields: {…} }`.
 *
 * READ-MERGE-WRITE, deliberately: `tenant_paywall_upsert` overwrites every column, so a partial
 * payload would reset the rest to defaults. See lib/paywall-copy. Edits the flat copy the SDK
 * renders immediately — there is no draft for these columns.
 */
export async function PATCH(req: Request) {
  return withApiKey(req, "paywall:write", async (ctx) => {
    const body = (await req.json().catch(() => null)) as { fields?: unknown } | null
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "body_must_be_json" }, { status: 400 })
    }

    const { data: current, error: readError } = await ctx.admin
      .from("tenant_paywall")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle()
    if (readError) return queryFailed("v1/paywall:read", readError) as NextResponse

    const merged = mergePaywallCopy(ctx.tenantId, current as Record<string, unknown> | null, body.fields)
    if ("error" in merged) return NextResponse.json(merged, { status: 400 })

    const { error } = await ctx.admin.rpc("tenant_paywall_upsert", { p_row: merged.row })
    // The RPC's messages (bad enum value, …) are actionable, so they are passed through as a 400.
    if (error) return NextResponse.json({ error: "paywall_update_failed", detail: error.message }, { status: 400 })

    await auditApiAction(ctx, "paywall.updated", `tenant_paywall:tenant_id=${ctx.tenantId}`, {
      fields: merged.changed,
    })
    return NextResponse.json({ ok: true, tenant_id: ctx.tenantId, updated: merged.changed })
  })
}
