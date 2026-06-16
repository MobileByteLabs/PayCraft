import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

export async function POST(req: NextRequest) {
  const { tenant_id } = await req.json()
  if (!tenant_id)
    return NextResponse.json({ error: "tenant_id required" }, { status: 400 })

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  // Verify the caller is a member of the requested tenant.
  const { data: admin } = await supabase
    .from("tenant_admins")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("tenant_id", tenant_id)
    .maybeSingle()

  if (!admin)
    return NextResponse.json({ error: "not a member of this app" }, { status: 403 })

  const resp = NextResponse.json({ ok: true })
  resp.cookies.set("paycraft_active_app_id", tenant_id, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  })
  return resp
}

export async function GET(req: NextRequest) {
  const activeId = req.cookies.get("paycraft_active_app_id")?.value
  return NextResponse.json({ tenant_id: activeId ?? null })
}
