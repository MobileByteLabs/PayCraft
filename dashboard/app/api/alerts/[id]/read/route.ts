export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { unreadCounts } from "@/lib/alerts"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST /api/alerts/:id/read → { ok, unread_count, unread_critical }
 *
 * Marks one alert of the ACTIVE app read. RLS (211) already limits an admin to their own apps' rows and to the
 * read_at column; the tenant filter keeps an admin of several apps from marking another app's alert by id.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return NextResponse.json({ error: "bad_id" }, { status: 400 })
  const { tenant } = await requireTenant()
  const sb = createClient()
  const { data, error } = await sb
    .from("tenant_alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", tenant.id)
    .eq("id", params.id)
    .is("read_at", null)
    .select("id")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const counts = await unreadCounts(sb, tenant.id)
  return NextResponse.json({ ok: true, updated: (data ?? []).length, unread_count: counts.total, unread_critical: counts.critical })
}
