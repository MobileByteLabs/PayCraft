import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const { error } = await supabase.rpc("tenant_coupons_delete", { p_id: params.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "coupon.deactivated",
    p_resource: `tenant_coupons:id=${params.id}`,
  })
  return NextResponse.json({ ok: true })
}
