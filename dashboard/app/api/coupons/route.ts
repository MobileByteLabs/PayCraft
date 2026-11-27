export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { COUPON_SYNC_PROVIDERS } from "@/lib/coupon-provider-sync"

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_coupons_list", { p_tenant_id: tenant.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ coupons: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()

  const payload = {
    ...body,
    tenant_id: tenant.id,
    code: String(body.code ?? "").trim().toUpperCase(),
  }

  const { data: id, error } = await supabase.rpc("tenant_coupons_upsert", {
    p_row: payload,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: body.id ? "coupon.updated" : "coupon.created",
    p_resource: `tenant_coupons:id=${id}`,
    p_after: payload,
  })

  // Provider sync is the caller's next step: POST /api/coupons/{id}/sync?provider=… once per entry in
  // `providers`. A fan-out from here ran after the response and Cloudflare cut it off — no store got the coupon.
  return NextResponse.json({ id, providers: COUPON_SYNC_PROVIDERS })
}