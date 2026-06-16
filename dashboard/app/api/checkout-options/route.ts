import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { listCheckoutOptions } from "@/lib/checkout-options"
import { detectCustomerCountry, currencyForCountry } from "@/lib/customer-geo"
import type { ProductForRouting } from "@/lib/checkout-router"

/**
 * Return ALL eligible checkout methods for a product + customer.
 *
 * GET /api/checkout-options?product_id=…&country=IN&currency=INR
 *
 * Use when you want the SDK to render a picker ("Pay with UPI / Pay with
 * card / Pay with Stripe"). For the auto-pick-cheapest single-URL flow,
 * call /api/checkout-url instead.
 *
 * Country resolution: query param → CDN header (Cloudflare / Vercel) →
 * merchant's primary country. Currency: explicit → currency-from-country
 * heuristic → product's base_currency.
 *
 * Response shape:
 *   {
 *     resolved: { country, currency },
 *     options: [
 *       { method, display_name, provider, url, estimated_fee_percent,
 *         supports_subscription, currency, recommended, badge, ... }
 *     ]
 *   }
 *
 * `options[0]` is the recommended pick (cheapest eligible). UI render
 * order should preserve this — surface it as the primary CTA.
 */
export async function GET(req: NextRequest) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const url = new URL(req.url)
  const productId = url.searchParams.get("product_id")
  if (!productId) {
    return NextResponse.json({ error: "product_id required" }, { status: 400 })
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

  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("country_code")
    .eq("id", tenant.id)
    .single<{ country_code: string | null }>()

  const country = detectCustomerCountry(req, tenantRow?.country_code ?? null)
  const explicitCurrency = url.searchParams.get("currency")?.toUpperCase()
  const currency =
    explicitCurrency ?? currencyForCountry(country) ?? product.base_currency

  const options = await listCheckoutOptions({
    tenantId: tenant.id,
    product: product as ProductForRouting,
    customer: { country, currency },
  })

  if (options.length === 0) {
    return NextResponse.json(
      {
        error: "no_eligible_method",
        resolved: { country, currency },
        message:
          "No connected payment method can fulfil this checkout in the customer's currency. Connect Stripe, Razorpay, or configure UPI at /providers.",
      },
      { status: 409 },
    )
  }

  return NextResponse.json({
    resolved: { country, currency },
    options,
  })
}
