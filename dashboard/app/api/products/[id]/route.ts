import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  stripeSyncProduct,
  razorpaySyncProduct,
  cashfreeSyncProduct,
} from "@/lib/stripe-route-helper"

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()

  const { data: existing } = await supabase
    .from("tenant_products")
    .select("id, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()
  if (!existing)
    return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { pricing_rows, ...productPayload } = body
  const payload = { ...productPayload, id: params.id, tenant_id: tenant.id }

  const { data: id, error } = await supabase.rpc("tenant_products_upsert", {
    p_row: payload,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.updated",
    p_resource: `tenant_products:id=${id}`,
    p_before: existing,
    p_after: payload,
  })

  if (Array.isArray(pricing_rows) && pricing_rows.length > 0) {
    await supabase.rpc("tenant_pricing_bulk_upsert", {
      p_tenant_id: tenant.id,
      p_product_id: params.id,
      p_rows: pricing_rows,
    })
  }

  void Promise.all([
    stripeSyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
      existingStripeProductId: existing.stripe_product_id ?? undefined,
      existingPrices: existing.stripe_price_id_by_currency ?? undefined,
    }),
    razorpaySyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
      existingRazorpayPlanIds: existing.razorpay_plan_id_by_currency ?? undefined,
    }),
    cashfreeSyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
    }),
  ])

  return NextResponse.json({ id })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const { data: existing } = await supabase
    .from("tenant_products")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()
  if (!existing)
    return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { error } = await supabase.rpc("tenant_products_delete", {
    p_id: params.id,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.deleted",
    p_resource: `tenant_products:id=${params.id}`,
    p_before: existing,
  })
  return NextResponse.json({ ok: true })
}
