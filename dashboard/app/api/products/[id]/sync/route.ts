import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  stripeSyncProduct,
  razorpaySyncProduct,
  cashfreeSyncProduct,
} from "@/lib/stripe-route-helper"

/**
 * Re-sync a single product to whichever providers are connected. Useful when
 * a row failed initial sync, when the operator changed pricing and wants to
 * push a fresh Stripe Price, or when they re-connected Stripe under a fresh
 * account and need the product re-created on the new account.
 *
 * Body: {} (no params — the route operates on the URL's :id only)
 * Returns: { stripe: { status, message? }, razorpay: { status, message? } }
 */
export async function POST(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  // Load the product + its per-currency pricing so the sync helpers have the
  // full inputs (the same shape the create/update routes pass through).
  const { data: product, error } = await supabase
    .from("tenant_products")
    .select(
      "id, sku, type, display_name, interval, base_price_cents, base_currency, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency",
    )
    .eq("tenant_id", tenant.id)
    .eq("id", params.id)
    .single()
  if (error || !product) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  const { data: pricing = [] } = await supabase
    .from("tenant_pricing")
    .select("currency, amount_cents")
    .eq("tenant_id", tenant.id)
    .eq("product_id", params.id)

  const body = {
    ...product,
    pricing_rows: (pricing ?? []).map((r: any) => ({
      currency: r.currency,
      amount_cents: r.amount_cents,
    })),
  }

  type Report = { status: "ok" | "failed" | "skipped"; message?: string }
  const stripeReport: Report = { status: "skipped" }
  const razorpayReport: Report = { status: "skipped" }

  try {
    await stripeSyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
      existingStripeProductId: product.stripe_product_id ?? undefined,
      existingPrices: product.stripe_price_id_by_currency ?? undefined,
    })
    const { data: after } = await supabase
      .from("tenant_products")
      .select("stripe_product_id")
      .eq("id", params.id)
      .single()
    stripeReport.status = after?.stripe_product_id ? "ok" : "failed"
    if (!after?.stripe_product_id) {
      stripeReport.message =
        "sync helper returned but stripe_product_id is still null — check server logs (Stripe key invalid? connection missing?)"
    }
  } catch (e: any) {
    stripeReport.status = "failed"
    stripeReport.message = e?.message ?? String(e)
  }

  try {
    await razorpaySyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
      existingRazorpayPlanIds: product.razorpay_plan_id_by_currency ?? undefined,
    })
    const { data: after } = await supabase
      .from("tenant_products")
      .select("razorpay_plan_id_by_currency")
      .eq("id", params.id)
      .single()
    razorpayReport.status =
      after?.razorpay_plan_id_by_currency &&
      Object.keys(after.razorpay_plan_id_by_currency).length > 0
        ? "ok"
        : "failed"
  } catch (e: any) {
    razorpayReport.status = "failed"
    razorpayReport.message = e?.message ?? String(e)
  }

  const cashfreeReport: Report = { status: "skipped" }
  try {
    await cashfreeSyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
    })
    // Cashfree links are stored at the tenant_providers level keyed by
    // currency. Probe for INR specifically since that's the only currency
    // Cashfree supports.
    const { data: cfRow } = await supabase
      .from("tenant_providers")
      .select("test_payment_links, live_payment_links")
      .eq("tenant_id", tenant.id)
      .eq("provider", "cashfree")
      .maybeSingle()
    const links = cfRow?.live_payment_links ?? cfRow?.test_payment_links ?? {}
    cashfreeReport.status =
      links && typeof links === "object" && (links as any).INR ? "ok" : "failed"
    if (cashfreeReport.status === "failed") {
      cashfreeReport.message =
        "Cashfree returned no INR link for this product — check Cashfree credentials and product type (Cashfree only handles one-time INR via /pg/links; subscriptions need UPI Autopay)"
    }
  } catch (e: any) {
    cashfreeReport.status = "failed"
    cashfreeReport.message = e?.message ?? String(e)
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "product.sync",
    p_resource: `tenant_products:id=${params.id}`,
    p_after: {
      sku: product.sku,
      stripe: stripeReport,
      razorpay: razorpayReport,
      cashfree: cashfreeReport,
    },
  })

  return NextResponse.json({
    stripe: stripeReport,
    razorpay: razorpayReport,
    cashfree: cashfreeReport,
  })
}
