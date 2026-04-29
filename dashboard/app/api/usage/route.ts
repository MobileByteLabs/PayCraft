import { createClient } from "@/lib/supabase-server"
import { NextResponse } from "next/server"

export async function GET() {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data, error } = await supabase.rpc("get_tenant_usage", {
    p_user_id: session.user.id,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
