export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/** POST /api/alerts/read-all → { ok, updated } — marks every unread alert of the ACTIVE app read. */
export async function POST() {
  const { tenant } = await requireTenant()
  const sb = createClient()
  const { data, error } = await sb
    .from("tenant_alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", tenant.id)
    .is("read_at", null)
    .select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, updated: (data ?? []).length })
}
