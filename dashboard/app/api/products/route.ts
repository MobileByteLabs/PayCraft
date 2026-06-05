import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()
  const payload = { ...body, tenant_id: tenant.id }
  const { data: id, error } = await supabase.rpc("tenant_products_upsert", {
    p_row: payload,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.created",
    p_resource: `tenant_products:id=${id}`,
    p_after: payload,
  })
  return NextResponse.json({ id })
}
