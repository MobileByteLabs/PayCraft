export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Apply a gallery template to the tenant's DRAFT paywall tree.
 *
 * The route is thin on purpose: `tenant_paywall_apply_template` owns the admin check, the
 * localization merge and the validation, because those must hold for every caller — not just this
 * one. A route that merged copy itself would be a second implementation to keep correct.
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json()) as { slug?: string; mode?: string }

  const slug = typeof body.slug === "string" ? body.slug : null
  const mode = body.mode === "update" ? "update" : "create"
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 })
  }

  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_paywall_apply_template", {
    p_tenant: tenant.id,
    p_slug: slug,
    p_mode: mode,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "paywall.template_applied",
    p_resource: `tenant_paywall:tenant_id=${tenant.id}`,
    p_after: data,
  })

  // Applying writes the DRAFT only. Saying so in the response is not decoration: the difference
  // between "your app changed" and "your draft changed" is the difference between a safe click
  // and a frightening one.
  return NextResponse.json({ ok: true, ...(data as object), published: false })
}
