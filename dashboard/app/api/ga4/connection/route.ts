export const runtime = "edge"

// Analytics ▸ Google Analytics (paycraft-paywall-analytics T16). PUT { propertyId }: run a tiny test report with
// PayCraft's Viewer account, then store the property with the result (verified, or why not). DELETE: disconnect.

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { paycraftGa4Account, runReport } from "@/lib/ga4"

export async function PUT(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json().catch(() => null)) as { propertyId?: unknown; streamIds?: unknown } | null
  const propertyId = String(body?.propertyId ?? "").trim()
  if (!/^[0-9]{6,12}$/.test(propertyId)) return NextResponse.json({ error: "bad_property_id" }, { status: 400 })
  // Data streams of THIS app when the property also holds others (migration 190); empty = whole property.
  const streamIds = Array.isArray(body?.streamIds) ? body!.streamIds.map(String).map((s) => s.trim()).filter(Boolean) : []
  if (streamIds.length > 20 || streamIds.some((s) => !/^[0-9]{6,15}$/.test(s))) return NextResponse.json({ error: "bad_stream_ids" }, { status: 400 })
  const account = paycraftGa4Account()
  if (!account) return NextResponse.json({ error: "not_configured" }, { status: 503 })

  const check = await runReport(propertyId, {
    dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
    metrics: [{ name: "activeUsers" }],
  }, { token: account.token, saEmail: account.email })

  const supabase = createClient()
  const { data: saved, error } = await supabase.rpc("tenant_ga4_connection_save", {
    p_tenant_id: tenant.id,
    p_property_id: propertyId,
    p_verified: check.ok,
    p_error: check.ok ? null : check.error,
    p_stream_ids: streamIds,
  })
  if (error) {
    return NextResponse.json({ error: error.code === "42501" ? "forbidden" : error.message }, { status: error.code === "42501" ? 403 : 500 })
  }
  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "ga4.connect",
    p_resource: `tenant_ga4_connections:tenant_id=${tenant.id}`,
    p_after: { property_id: propertyId, stream_ids: streamIds, verified: check.ok, error: check.ok ? null : check.error },
  })
  return NextResponse.json({ connection: saved, ok: check.ok, ...(check.ok ? {} : { error: check.error, fix: check.fix }) })
}

export async function DELETE() {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const { error } = await supabase.rpc("tenant_ga4_connection_delete", { p_tenant_id: tenant.id })
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 })
  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "ga4.disconnect",
    p_resource: `tenant_ga4_connections:tenant_id=${tenant.id}`,
    p_after: null,
  })
  return NextResponse.json({ ok: true })
}
