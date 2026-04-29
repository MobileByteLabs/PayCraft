import { createClient } from "@/lib/supabase-server"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { mode } = await request.json()

  if (mode !== "test" && mode !== "live") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
  }

  const { data, error } = await supabase.rpc("rotate_api_key", {
    p_user_id: session.user.id,
    p_mode: mode,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
