import { createClient } from "@/lib/supabase-server"
import { NextRequest, NextResponse } from "next/server"

/**
 * PUT /api/alert-prefs — update tenant alert preferences.
 */
export async function PUT(request: NextRequest) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { tenant_id, welcome, limit_warn, limit_hit, webhook_fail, sub_expiry } = body

  // Verify user owns this tenant
  const { data: admin } = await supabase
    .from("tenant_admins")
    .select("role")
    .eq("user_id", session.user.id)
    .eq("tenant_id", tenant_id)
    .single()

  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { error } = await supabase
    .from("tenant_alert_prefs")
    .upsert({
      tenant_id,
      welcome,
      limit_warn,
      limit_hit,
      webhook_fail,
      sub_expiry,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
