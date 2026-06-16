import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { routeCheckout, type ProductForRouting } from "@/lib/checkout-router"

/**
 * SDK + dashboard checkout URL resolver.
 *
 * GET /api/checkout-url?product_id=…&country=IN&currency=INR
 *   → 200 { url, method, provider, estimated_fee_percent, ... }
 *   → 404 if product not found
 *   → 409 if no eligible method (merchant hasn't connected any provider /
 *         no method supports the customer's currency)
 *
 * Designed so the PayCraft SDK can replace its hardcoded "fetch the Stripe
 * Payment Link" logic with a single call here. The dashboard's product
 * detail page also calls this for a live preview ("here's where customers
 * in India will be routed at checkout time").
 *
 * Note: this is auth'd via session cookie like the rest of the dashboard
 * API. SDK clients use a separate `pk_…` API key flow via the
 * /functions/v1/config Edge Function — that endpoint loads the router
 * server-side too but with the tenant resolved from the API key, not the
 * session cookie. Both paths use the same `routeCheckout()` helper.
 */
export async function GET(req: NextRequest) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const url = new URL(req.url)
  const productId = url.searchParams.get("product_id")
  const country = url.searchParams.get("country")
  const currency = url.searchParams.get("currency")
  if (!productId) {
    return NextResponse.json({ error: "product_id required" }, { status: 400 })
  }

  const { data: product, error } = await supabase
    .from("tenant_products")
    .select(
      "id, type, display_name, base_price_cents, base_currency, interval, stripe_price_id_by_currency, razorpay_plan_id_by_currency",
    )
    .eq("id", productId)
    .eq("tenant_id", tenant.id)
    .single()
  if (error || !product) {
    return NextResponse.json({ error: "product not found" }, { status: 404 })
  }

  const route = await routeCheckout({
    tenantId: tenant.id,
    product: product as ProductForRouting,
    customer: {
      country: country?.toUpperCase() ?? null,
      currency: currency?.toUpperCase() ?? null,
    },
  })

  if (!route) {
    return NextResponse.json(
      {
        error: "no_eligible_method",
        message:
          "No connected payment method can fulfil this checkout. Connect Stripe, Razorpay, or configure UPI at /providers.",
      },
      { status: 409 },
    )
  }

  return NextResponse.json(route)
}
