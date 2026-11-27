export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { COUPON_SYNC_PROVIDERS, couponSyncArgsFromRow, syncCouponToProvider } from "@/lib/coupon-provider-sync"

/**
 * Sync ONE coupon to ONE provider. The coupon form calls this once per provider after saving: Cloudflare caps
 * sub-requests per invocation and the Google Play / App Store adapters iterate every product, so the old
 * fire-and-forget fan-out from the save route was cut off and reached no store.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { tenant } = await requireTenant()
  const provider = req.nextUrl.searchParams.get("provider") ?? ""
  if (!COUPON_SYNC_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 })
  }
  const supabase = createClient()
  // Through the same tenant-scoped RPC the coupon list uses.
  const { data, error } = await supabase.rpc("tenant_coupons_list", { p_tenant_id: tenant.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const row = (data ?? []).find((c: { id: string }) => c.id === params.id)
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 })

  const result = await syncCouponToProvider(provider, couponSyncArgsFromRow(row))
  return NextResponse.json(result, { status: result.error ? 502 : 200 })
}
