import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
export const dynamic = "force-dynamic"

/**
 * POST /v1/paywall/templates — apply a gallery template to the DRAFT tree.  Body: `{slug, mode?}`.
 *
 * The API-key twin of POST /api/paywall/templates. Thin for the same reason: the RPC owns the
 * localization merge and validation (and, since 173, accepts the service role this runs as).
 */
export async function POST(req: Request) {
  return withApiKey(req, "paywall:write", async (ctx) => {
    const body = (await req.json().catch(() => ({}))) as { slug?: unknown; mode?: unknown }
    const slug = typeof body.slug === "string" && body.slug ? body.slug : null
    if (!slug) return NextResponse.json({ error: "slug is required" }, { status: 400 })
    if (body.mode !== undefined && body.mode !== "create" && body.mode !== "update") {
      return NextResponse.json({ error: "invalid_mode", detail: "mode must be create or update" }, { status: 400 })
    }
    const mode = body.mode === "update" ? "update" : "create"

    const { data, error } = await ctx.admin.rpc("tenant_paywall_apply_template", {
      p_tenant: ctx.tenantId,
      p_slug: slug,
      p_mode: mode,
    })
    if (error) return NextResponse.json({ error: "apply_template_failed", detail: error.message }, { status: 400 })

    await auditApiAction(ctx, "paywall.template_applied", `tenant_paywall:tenant_id=${ctx.tenantId}`, { slug, mode })
    // Draft only — nothing a buyer sees changes until paycraft_paywall_publish.
    return NextResponse.json({ ok: true, tenant_id: ctx.tenantId, ...(data as object), published: false })
  })
}
