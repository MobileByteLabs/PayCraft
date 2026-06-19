import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  // Fetch the row first so we can audit the device_id that was revoked
  // (after DELETE the row is gone — we'd lose the value).
  const { data: row } = await supabase
    .from("test_devices")
    .select("device_id, label")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .maybeSingle()

  const { data, error } = await supabase.rpc("test_devices_revoke", {
    p_id: params.id,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)
    return NextResponse.json({ error: "not found" }, { status: 404 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "test_device.revoked",
    p_resource: `test_devices:id=${params.id}`,
    p_after: row ?? { id: params.id },
  })

  return NextResponse.json({ revoked: true })
}
