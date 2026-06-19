import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  stripeSyncProduct,
  razorpaySyncProduct,
  cashfreeSyncProduct,
} from "@/lib/stripe-route-helper"

/**
 * GET /api/pricing?product_id=<uuid>
 * Returns the saved per-locale pricing rows for the product.
 */
export async function GET(req: NextRequest) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const productId = req.nextUrl.searchParams.get("product_id")
  if (!productId)
    return NextResponse.json(
      { error: "product_id_required" },
      { status: 400 },
    )

  const { data, error } = await supabase
    .from("tenant_pricing")
    .select("locale, amount_cents, currency, source, source_ref, updated_at")
    .eq("tenant_id", tenant.id)
    .eq("product_id", productId)
    .order("locale")

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ rows: data ?? [] })
}

/**
 * POST /api/pricing
 * Body: { product_id: string, rows: [{ locale, amount_cents, currency, source? }] }
 * Bulk-upserts pricing rows via tenant_pricing_bulk_upsert RPC.
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json()
  const supabase = createClient()

  const productId: string | undefined = body?.product_id
  const rows: unknown = body?.rows
  if (!productId || !Array.isArray(rows))
    return NextResponse.json(
      { error: "product_id_and_rows_required" },
      { status: 400 },
    )

  const { data: written, error } = await supabase.rpc(
    "tenant_pricing_bulk_upsert",
    {
      p_tenant_id: tenant.id,
      p_product_id: productId,
      p_rows: rows,
    },
  )
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "pricing.bulk_upserted",
    p_resource: `tenant_pricing:product_id=${productId}`,
    p_after: { product_id: productId, rows_written: written },
  })

  // Auto-trigger provider sync so the new per-currency prices materialize as
  // Stripe Prices + Payment Links automatically. Mirrors the auto-sync pattern
  // in products/route.ts (CREATE) and products/[id]/route.ts (UPDATE) — every
  // mutation that affects pricing should refresh the cached payment_links.
  const { data: product } = await supabase
    .from("tenant_products")
    .select(
      "id, sku, type, display_name, interval, base_price_cents, base_currency, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", productId)
    .single()

  if (product) {
    const syncBody = {
      ...product,
      pricing_rows: (rows as Array<{ currency: string; amount_cents: number }>).map(r => ({
        currency: r.currency,
        amount_cents: r.amount_cents,
      })),
    }
    // Fire & forget — each helper internally try/catches so a provider outage
    // doesn't break the pricing write.
    await Promise.all([
      stripeSyncProduct(supabase, {
        tenantId: tenant.id,
        productId,
        body: syncBody,
        existingStripeProductId: product.stripe_product_id ?? undefined,
        existingPrices: product.stripe_price_id_by_currency ?? undefined,
      }),
      razorpaySyncProduct(supabase, {
        tenantId: tenant.id,
        productId,
        body: syncBody,
        existingRazorpayPlanIds: product.razorpay_plan_id_by_currency ?? undefined,
      }),
      cashfreeSyncProduct(supabase, {
        tenantId: tenant.id,
        productId,
        body: syncBody,
      }),
    ])
  }

  return NextResponse.json({ ok: true, written })
}
