import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  stripeSyncProduct,
  razorpaySyncProduct,
  cashfreeSyncProduct,
  googlePlaySyncProduct,
  appStoreSyncProduct,
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
      "id, sku, type, display_name, interval, base_price_cents, base_currency, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency, play_product_id, app_store_product_id",
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
    const res = await razorpaySyncProduct(supabase, {
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
    const populated = !!(
      after?.razorpay_plan_id_by_currency &&
      Object.keys(after.razorpay_plan_id_by_currency).length > 0
    )
    razorpayReport.status = res.ok && populated ? "ok" : "failed"
    if (razorpayReport.status === "failed" && res.error) {
      razorpayReport.message = res.error
    }
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

  // Native stores — only meaningful for subscription products; the helpers
  // self-skip when the tenant hasn't connected the store or the product isn't
  // a subscription. "ok" = the product id landed on the row.
  const googlePlayReport: Report = { status: "skipped" }
  try {
    await googlePlaySyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
      existingPlayProductId: product.play_product_id ?? undefined,
    })
    const { data: after } = await supabase
      .from("tenant_products")
      .select("play_product_id")
      .eq("id", params.id)
      .single()
    if (product.type !== "subscription") {
      googlePlayReport.status = "skipped"
      googlePlayReport.message = "native store sync only applies to subscription products"
    } else if (after?.play_product_id) {
      googlePlayReport.status = "ok"
    } else {
      googlePlayReport.status = "failed"
      googlePlayReport.message =
        "sync helper returned without populating play_product_id — check that google_play credentials + package_name are configured (server logs carry the Play API error)"
    }
  } catch (e: any) {
    googlePlayReport.status = "failed"
    googlePlayReport.message = e?.message ?? String(e)
  }

  const appStoreReport: Report = { status: "skipped" }
  try {
    await appStoreSyncProduct(supabase, {
      tenantId: tenant.id,
      productId: params.id,
      body,
      existingAppStoreProductId: product.app_store_product_id ?? undefined,
    })
    const { data: after } = await supabase
      .from("tenant_products")
      .select("app_store_product_id")
      .eq("id", params.id)
      .single()
    if (product.type !== "subscription") {
      appStoreReport.status = "skipped"
      appStoreReport.message = "native store sync only applies to subscription products"
    } else if (after?.app_store_product_id) {
      appStoreReport.status = "ok"
    } else {
      appStoreReport.status = "failed"
      appStoreReport.message =
        "sync helper returned without populating app_store_product_id — check that app_store credentials (key_id/issuer_id/bundle_id + .p8) are configured (server logs carry the ASC API error)"
    }
  } catch (e: any) {
    appStoreReport.status = "failed"
    appStoreReport.message = e?.message ?? String(e)
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
      google_play: googlePlayReport,
      app_store: appStoreReport,
    },
  })

  return NextResponse.json({
    stripe: stripeReport,
    razorpay: razorpayReport,
    cashfree: cashfreeReport,
    google_play: googlePlayReport,
    app_store: appStoreReport,
  })
}
