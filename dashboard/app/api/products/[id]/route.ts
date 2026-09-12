export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { runProductSync } from "@/lib/stripe-route-helper"

// GET was missing entirely (F17) while PATCH and DELETE shipped — which is why the pricing page
// carried a hardcoded `display_name: "Product"` / `base_price_cents: 999` fallback. That stub is
// removed in the same change; this handler is what makes removing it possible.
//
// Tenant scoping is on the query, not on trust in the URL: `.eq("tenant_id", tenant.id)` means a
// merchant who guesses another tenant's product UUID gets 404, not their row.
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data, error } = await supabase
    .from("tenant_products")
    .select(
      "id, sku, type, display_name, base_price_cents, base_currency, " +
        "interval, active, package_id, trial_enabled, trial_duration_days, " +
        "pricing_mode, global_price_cents, global_currency, " +
        "display_order, play_product_id, app_store_product_id, updated_at",
    )
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()
  if (error || !data)
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json(data, { status: 200 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()

  // SELECT * rather than the four provider-id columns this used to fetch. Two reasons, and the
  // first is a bug fix:
  //
  //  1. PATCH is partial by definition, but tenant_products_upsert takes a FULL row — it reads
  //     p_row->>'sku' straight into a NOT NULL column. A PATCH that changes only `active` (which is
  //     what the dashboard's enable/disable toggle sends) therefore arrived with no sku and the
  //     insert failed: "null value in column sku violates not-null constraint", surfaced to the
  //     operator as a 500 on a toggle. Merging the existing row underneath the patch is what makes
  //     a partial payload mean "change these fields", which is what the caller already assumed.
  //  2. `existing` is also the audit log's before-image. A four-column before-image cannot show
  //     what actually changed, so every product.updated entry was unreviewable.
  //
  // Extra columns (created_at, updated_at, …) are harmless: the RPC reads named keys out of the
  // jsonb and ignores everything else.
  const { data: existing } = await supabase
    .from("tenant_products")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()
  if (!existing)
    return NextResponse.json({ error: "not_found" }, { status: 404 })

  const { pricing_rows, ...productPayload } = body
  // Order matters: existing first, the caller's fields on top, then id/tenant_id pinned last so a
  // body cannot retarget the write at another row or another tenant.
  const payload = { ...existing, ...productPayload, id: params.id, tenant_id: tenant.id }

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

  // Auto-sync the change to EVERY connected provider — including Google Play and
  // the App Store (e.g. toggling a trial must push the store free-trial offer, not
  // just the Stripe/Razorpay trial). Fire-and-forget: the durable sync_state + the
  // dashboard's realtime island reflect the outcome without blocking the response.
  void runProductSync(supabase, {
    tenantId: tenant.id,
    productId: params.id,
    body,
    productName: body.display_name,
    existingStripeProductId: existing.stripe_product_id ?? undefined,
    existingPrices: existing.stripe_price_id_by_currency ?? undefined,
    existingRazorpayPlanIds: existing.razorpay_plan_id_by_currency ?? undefined,
  })

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