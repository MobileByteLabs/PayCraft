import { NextRequest, NextResponse } from "next/server"
import { createClient as createServerSupabase } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const { email, role } = await req.json()
  if (!email || !["owner", "admin", "viewer"].includes(role)) {
    return NextResponse.json(
      { error: "email + role (owner|admin|viewer) required" },
      { status: 400 },
    )
  }

  // service-role client to invite via auth.admin
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: inviteData, error: inviteErr } =
    await admin.auth.admin.inviteUserByEmail(email, {
      data: { tenant_id: tenant.id, role },
    })
  if (inviteErr) {
    return NextResponse.json({ error: inviteErr.message }, { status: 500 })
  }
  const invitedUserId = inviteData?.user?.id
  if (!invitedUserId) {
    return NextResponse.json(
      { error: "could not provision invited user" },
      { status: 500 },
    )
  }

  const supabase = createServerSupabase()
  const { error } = await supabase
    .from("tenant_admins")
    .insert({ tenant_id: tenant.id, user_id: invitedUserId, role })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "team.invited",
    p_resource: `tenant_admins:email=${email}`,
    p_after: { email, role },
  })

  return NextResponse.json({ ok: true })
}
