import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { initiateCheckout } from "@/lib/checkout-initiator"
import type { ProductForRouting } from "@/lib/checkout-router"

/**
 * Per-customer checkout initiation.
 *
 * POST /api/checkout-initiate
 * Body:
 *   {
 *     product_id: string,
 *     method:     string ("direct_upi" | "stripe_card" | "razorpay" | "cashfree_upi"),
 *     customer:   { email: string, name?: string, phone?: string,
 *                   country?: string, currency?: string }
 *   }
 *
 * Returns:
 *   200 { url, method, provider, currency, reference?, qr_payload?, subscription_id?, note? }
 *   400 { error } — bad input
 *   404 { error: "product not found" }
 *   409 { error: "method not eligible" } — try a different method
 *   500 { error } — upstream provider failure
 *
 * Used after `GET /api/checkout-options` enumerated the choices. The SDK
 * collects the customer's email + chosen method, posts here, and opens
 * the returned URL.
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const body = await req.json().catch(() => ({}))

  const productId = body?.product_id
  const method = body?.method
  const customer = body?.customer ?? {}

  if (!productId || typeof productId !== "string") {
    return NextResponse.json({ error: "product_id required" }, { status: 400 })
  }
  if (!method || typeof method !== "string") {
    return NextResponse.json({ error: "method required" }, { status: 400 })
  }
  if (!customer.email || typeof customer.email !== "string") {
    return NextResponse.json(
      { error: "customer.email required (subscription mandates need it)" },
      { status: 400 },
    )
  }

  const { data: product } = await supabase
    .from("tenant_products")
    .select(
      "id, type, display_name, base_price_cents, base_currency, interval, stripe_price_id_by_currency, razorpay_plan_id_by_currency",
    )
    .eq("id", productId)
    .eq("tenant_id", tenant.id)
    .single()
  if (!product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 })
  }

  try {
    const result = await initiateCheckout({
      tenantId: tenant.id,
      product: product as ProductForRouting,
      method,
      customer: {
        email: customer.email,
        name: customer.name ?? null,
        phone: customer.phone ?? null,
        country: customer.country?.toUpperCase() ?? null,
        currency: customer.currency?.toUpperCase() ?? null,
      },
    })

    await supabase.rpc("audit_log_emit", {
      p_tenant_id: tenant.id,
      p_actor_user_id: userId,
      p_actor_type: "user",
      p_action: "checkout.initiate",
      p_resource: `tenant_products:id=${productId}`,
      p_after: {
        method: result.method,
        provider: result.provider,
        currency: result.currency,
        subscription_id: result.subscription_id ?? null,
        customer_email: customer.email,
      },
    })

    return NextResponse.json(result)
  } catch (e: any) {
    const message = e?.message ?? String(e)
    // The initiator throws for "method not eligible" cases with descriptive
    // messages. Surface them as 409 so the SDK can fall back to another
    // method, and reserve 500 for unexpected upstream failures.
    const isClientError =
      message.includes("not configured") ||
      message.includes("not yet implemented") ||
      message.includes("only supports") ||
      message.includes("cannot fulfil") ||
      message.includes("not yet synced")
    return NextResponse.json(
      { error: message },
      { status: isClientError ? 409 : 500 },
    )
  }
}
