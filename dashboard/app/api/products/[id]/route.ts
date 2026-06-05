import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()

  // Verify ownership before mutating
  const { data: existing } = await supabase
    .from("tenant_products")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()
  if (!existing)
    return NextResponse.json({ error: "not_found" }, { status: 404 })

  const payload = { ...body, id: params.id, tenant_id: tenant.id }
  const { data: id, error } = await supabase.rpc("tenant_products_upsert", {
    p_row: payload,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.updated",
    p_resource: `tenant_products:id=${id}`,
    p_before: existing,
    p_after: payload,
  })
  return NextResponse.json({ id })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const { data: existing } = await supabase
    .from("tenant_products")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()
  if (!existing)
    return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { error } = await supabase.rpc("tenant_products_delete", {
    p_id: params.id,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.deleted",
    p_resource: `tenant_products:id=${params.id}`,
    p_before: existing,
  })
  return NextResponse.json({ ok: true })
}
