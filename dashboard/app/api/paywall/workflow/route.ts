export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/** Save the draft tree. Validation lives in the RPC, so every writer gets the same rules. */
export async function PUT(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json()) as { workflow?: unknown }
  if (!body.workflow || typeof body.workflow !== "object") {
    return NextResponse.json({ error: "workflow object is required" }, { status: 400 })
  }

  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_paywall_workflow_upsert", {
    p_tenant: tenant.id,
    p_workflow: body.workflow,
  })
  if (error) {
    // The validator's messages are written for a human ("unknown component type x") and are the
    // most useful thing the editor can show, so they are passed through rather than flattened.
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "paywall.workflow_saved",
    p_resource: `tenant_paywall:tenant_id=${tenant.id}`,
    p_after: { revision: data },
  })
  return NextResponse.json({ ok: true, revision: data, published: false })
}

/**
 * Publish the draft — the only call in this epic that changes what a customer sees.
 *
 * Kept as a separate verb on a separate action rather than a flag on the save, so "publish" can
 * never be something that happens as a side effect of typing.
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  const { data, error } = await supabase.rpc("tenant_paywall_publish", { p_tenant: tenant.id })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "paywall.published",
    p_resource: `tenant_paywall:tenant_id=${tenant.id}`,
    p_after: { published_revision: data },
  })
  return NextResponse.json({ ok: true, published_revision: data, published: true })
}
