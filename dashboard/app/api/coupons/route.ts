import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { syncCouponBestEffort as syncCouponToStripeBestEffort } from "@/lib/stripe-coupon-sync"
import { syncCouponBestEffort as syncCouponToRazorpayBestEffort } from "@/lib/razorpay-coupon-sync"

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

  // Best-effort provider sync — both run concurrently, failures only logged.
  void Promise.all([
    syncCouponToStripeBestEffort({
      tenantId: tenant.id,
      couponRowId: id as unknown as string,
      code: payload.code,
      name: payload.name ?? null,
      percentOff: Number(payload.percent_off),
      duration: payload.duration,
      durationInMonths: payload.duration_in_months ?? null,
      maxRedemptions: payload.max_redemptions ?? null,
      redeemBy: payload.redeem_by ?? null,
      existingStripeCouponId: null,
      existingStripePromotionCodeId: null,
    }),
    syncCouponToRazorpayBestEffort({
      tenantId: tenant.id,
      couponRowId: id as unknown as string,
      code: payload.code,
      name: payload.name ?? null,
      percentOff: Number(payload.percent_off),
      duration: payload.duration,
      durationInMonths: payload.duration_in_months ?? null,
      maxRedemptions: payload.max_redemptions ?? null,
      redeemBy: payload.redeem_by ?? null,
      existingRazorpayOfferId: null,
    }),
  ])

  return NextResponse.json({ id })
}
