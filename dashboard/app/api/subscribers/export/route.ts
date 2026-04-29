import { createClient } from "@/lib/supabase-server"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const tenantId = request.nextUrl.searchParams.get("tenant_id")
  const mode = request.nextUrl.searchParams.get("mode") || "live"

  if (!tenantId) {
    return NextResponse.json({ error: "Missing tenant_id" }, { status: 400 })
  }

  // Verify user has access to this tenant
  const { data: admin } = await supabase
    .from("tenant_admins")
    .select("tenant_id")
    .eq("user_id", session.user.id)
    .eq("tenant_id", tenantId)
    .single()

  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: subscribers } = await supabase
    .from("subscriptions")
    .select("email,plan,status,provider,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at")
    .eq("tenant_id", tenantId)
    .eq("mode", mode)
    .order("created_at", { ascending: false })

  if (!subscribers || subscribers.length === 0) {
    return new NextResponse("No subscribers found", { status: 404 })
  }

  const headers = Object.keys(subscribers[0])
  const csv = [
    headers.join(","),
    ...subscribers.map((row: Record<string, unknown>) =>
      headers.map((h) => `"${String(row[h] ?? "").replace(/"/g, '""')}"`).join(",")
    ),
  ].join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="subscribers-${mode}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
