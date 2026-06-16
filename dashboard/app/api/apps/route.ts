import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim())
    return NextResponse.json({ error: "name required" }, { status: 400 })

  const supabase = createClient()
  const { data, error } = await supabase.rpc("provision_app", {
    p_app_name: name.trim(),
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function GET() {
  const supabase = createClient()
  const { data: memberships } = await supabase.rpc("tenant_admins_list_for_user")
  const tenantIds = (memberships ?? []).map((r: any) => r.tenant_id)
  if (!tenantIds.length) return NextResponse.json([])

  const { data: apps } = await supabase
    .from("tenants")
    .select("id, name, plan, api_key_live, created_at")
    .in("id", tenantIds)
    .order("created_at")

  return NextResponse.json(apps ?? [])
}
