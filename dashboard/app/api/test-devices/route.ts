import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

const DEVICE_ID_PATTERN = /^[0-9a-f]{16}$/i

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data, error } = await supabase.rpc("test_devices_list", {
    p_tenant_id: tenant.id,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const deviceId = String(body.device_id ?? "").trim().toLowerCase()
  const label =
    body.label && String(body.label).trim().length > 0
      ? String(body.label).trim()
      : null

  if (!DEVICE_ID_PATTERN.test(deviceId)) {
    return NextResponse.json(
      {
        error:
          "device_id must be 16 hexadecimal characters (the value the SDK logs at initialize)",
      },
      { status: 400 },
    )
  }

  const supabase = createClient()
  const { data, error } = await supabase.rpc("test_devices_register", {
    p_tenant_id: tenant.id,
    p_device_id: deviceId,
    p_label: label,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "test_device.registered",
    p_resource: `test_devices:device_id=${deviceId}`,
    p_after: { device_id: deviceId, label },
  })

  return NextResponse.json(data)
}
