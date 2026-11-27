import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { runProductSync } from "@/lib/stripe-route-helper"

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()

  // Strip pricing_rows from the product payload — stored separately in tenant_pricing.
  const { pricing_rows, ...productPayload } = body
  const payload = { ...productPayload, tenant_id: tenant.id }

  const { data: id, error } = await supabase.rpc("tenant_products_upsert", {
    p_row: payload,
  })
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.created",
    p_resource: `tenant_products:id=${id}`,
    p_after: payload,
  })

  // Persist per-country price rows when provided (auto / manual mode).
  if (Array.isArray(pricing_rows) && pricing_rows.length > 0) {
    await supabase.rpc("tenant_pricing_bulk_upsert", {
      p_tenant_id: tenant.id,
      p_product_id: id,
      p_rows: pricing_rows,
    })
  }

  // Immediate, durable multi-provider sync. runProductSync marks the product
  // `syncing` up front (so a tab-close mid-run stays retryable — "save for later"),
  // fans out to every provider (base product + free-trial offer), and records the
  // per-provider outcome so the dashboard can show success/failure and offer a
  // retry with the real server reason. Never throws (all provider errors captured).
  const summary = await runProductSync(supabase, { tenantId: tenant.id, productId: id, body })

  return NextResponse.json({ id, sync_status: summary.status, providers: summary.providers })
}