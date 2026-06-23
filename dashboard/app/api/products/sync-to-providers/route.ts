import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { stripeSyncProduct, razorpaySyncProduct } from "@/lib/stripe-route-helper"

/**
 * Bulk re-sync of locally-saved products to the connected payment providers.
 *
 * Use case: the operator created tenant_products rows BEFORE connecting Stripe
 * / Razorpay (or under a provider that was later replaced), so those rows
 * lack stripe_product_id / razorpay_plan_id_by_currency. Once a provider is
 * connected, this route pushes every "unsynced" product up to the provider's
 * API in sequence (idempotency keys in stripe-product-sync.ts make this safe
 * to retry).
 *
 * GET — preview: returns counts of unsynced products per provider.
 * POST — execute: iterates the unsynced sets, runs stripe/razorpaySyncProduct
 *        for each, returns a per-product result array.
 */
/**
 * Whether a given payment provider is actually connected for this tenant. We
 * only nag the operator about unsynced products for providers they've wired
 * up — otherwise the banner would permanently complain about Razorpay drift
 * on a Stripe-only deployment, etc.
 */
async function providerConnections(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<{ stripe: boolean; razorpay: boolean }> {
  const [stripeStatus, razorpayStatus] = await Promise.all([
    supabase
      .rpc("tenant_stripe_provider_status", { p_tenant_id: tenantId })
      .single<{ source: string | null }>(),
    supabase
      .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "razorpay" })
      .single<{ connected: boolean }>(),
  ])
  return {
    stripe: !!stripeStatus.data?.source,
    razorpay: !!razorpayStatus.data?.connected,
  }
}

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const connected = await providerConnections(supabase, tenant.id)

  // Only probe unsynced products for connected providers — we don't want to
  // surface "4 not synced to Razorpay" when Razorpay isn't even configured.
  const [stripeRowsResp, razorpayRowsResp] = await Promise.all([
    connected.stripe
      ? supabase.rpc("tenant_products_unsynced", {
          p_tenant_id: tenant.id,
          p_provider: "stripe",
        })
      : Promise.resolve({ data: [] }),
    connected.razorpay
      ? supabase.rpc("tenant_products_unsynced", {
          p_tenant_id: tenant.id,
          p_provider: "razorpay",
        })
      : Promise.resolve({ data: [] }),
  ])
  const stripeRows = stripeRowsResp.data ?? []
  const razorpayRows = razorpayRowsResp.data ?? []

  // Distinct-product count — the same row showing up in both lists shouldn't
  // be counted twice (banner shows "N products need sync", not "N sync ops").
  const uniqueIds = new Set<string>([
    ...stripeRows.map((r: any) => r.id),
    ...razorpayRows.map((r: any) => r.id),
  ])

  return NextResponse.json({
    providers_connected: connected,
    unique_unsynced_count: uniqueIds.size,
    stripe: { unsynced_count: stripeRows.length, items: stripeRows },
    razorpay: { unsynced_count: razorpayRows.length, items: razorpayRows },
  })
}

interface SyncReport {
  product_id: string
  sku: string
  display_name: string
  status: "ok" | "failed" | "skipped"
  message?: string
}

async function loadFullProductBodies(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  ids: string[],
): Promise<Record<string, any>> {
  if (!ids.length) return {}
  // Hydrate each product with its pricing_rows so the sync helper sees the
  // full per-currency matrix, not just the base price.
  const { data: products = [] } = await supabase
    .from("tenant_products")
    .select(
      "id, sku, type, display_name, interval, base_price_cents, base_currency, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency",
    )
    .eq("tenant_id", tenantId)
    .in("id", ids)
  const { data: pricing = [] } = await supabase
    .from("tenant_pricing")
    .select("product_id, currency, amount_cents")
    .eq("tenant_id", tenantId)
    .in("product_id", ids)
  const pricingByProduct: Record<string, Array<{ currency: string; amount_cents: number }>> = {}
  for (const row of pricing ?? []) {
    if (!pricingByProduct[row.product_id]) pricingByProduct[row.product_id] = []
    pricingByProduct[row.product_id].push({
      currency: row.currency,
      amount_cents: row.amount_cents,
    })
  }
  const out: Record<string, any> = {}
  for (const p of products ?? []) {
    out[p.id] = {
      ...p,
      pricing_rows: pricingByProduct[p.id] ?? [],
    }
  }
  return out
}

export async function POST() {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()

  const connected = await providerConnections(supabase, tenant.id)

  const [stripeRowsResp, razorpayRowsResp] = await Promise.all([
    connected.stripe
      ? supabase.rpc("tenant_products_unsynced", {
          p_tenant_id: tenant.id,
          p_provider: "stripe",
        })
      : Promise.resolve({ data: [] }),
    connected.razorpay
      ? supabase.rpc("tenant_products_unsynced", {
          p_tenant_id: tenant.id,
          p_provider: "razorpay",
        })
      : Promise.resolve({ data: [] }),
  ])
  const stripeRows = stripeRowsResp.data ?? []
  const razorpayRows = razorpayRowsResp.data ?? []

  const allIds = [
    ...((stripeRows ?? []) as any[]).map((r) => r.id),
    ...((razorpayRows ?? []) as any[]).map((r) => r.id),
  ]
  const bodies = await loadFullProductBodies(
    supabase,
    tenant.id,
    Array.from(new Set(allIds)),
  )

  const stripeReports: SyncReport[] = []
  for (const row of (stripeRows ?? []) as any[]) {
    const body = bodies[row.id]
    if (!body) {
      stripeReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: "skipped",
        message: "product row not found during hydration",
      })
      continue
    }
    try {
      await stripeSyncProduct(supabase, {
        tenantId: tenant.id,
        productId: row.id,
        body,
        existingStripeProductId: body.stripe_product_id ?? undefined,
        existingPrices: body.stripe_price_id_by_currency ?? undefined,
      })
      // Re-check whether the row got stripe_product_id populated — that's the
      // only way to know whether the best-effort sync actually landed.
      const { data: after } = await supabase
        .from("tenant_products")
        .select("stripe_product_id")
        .eq("id", row.id)
        .single()
      if (after?.stripe_product_id) {
        stripeReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "ok",
        })
      } else {
        stripeReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "failed",
          message:
            "sync helper returned without populating stripe_product_id — check server logs for the underlying error (likely missing/invalid Stripe credentials)",
        })
      }
    } catch (e: any) {
      stripeReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: "failed",
        message: e?.message ?? String(e),
      })
    }
  }

  const razorpayReports: SyncReport[] = []
  for (const row of (razorpayRows ?? []) as any[]) {
    const body = bodies[row.id]
    if (!body) {
      razorpayReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: "skipped",
        message: "product row not found during hydration",
      })
      continue
    }
    try {
      const res = await razorpaySyncProduct(supabase, {
        tenantId: tenant.id,
        productId: row.id,
        body,
        existingRazorpayPlanIds: body.razorpay_plan_id_by_currency ?? undefined,
      })
      const { data: after } = await supabase
        .from("tenant_products")
        .select("razorpay_plan_id_by_currency")
        .eq("id", row.id)
        .single()
      const populated = !!(
        after?.razorpay_plan_id_by_currency &&
        Object.keys(after.razorpay_plan_id_by_currency).length > 0
      )
      const ok = res.ok && populated
      razorpayReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: ok ? "ok" : "failed",
        message: ok
          ? undefined
          : res.error ??
            "sync helper returned without populating razorpay_plan_id_by_currency (check Razorpay credentials)",
      })
    } catch (e: any) {
      razorpayReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: "failed",
        message: e?.message ?? String(e),
      })
    }
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "products.bulk_sync",
    p_resource: `tenant_products`,
    p_after: {
      stripe: stripeReports.map((r) => ({ id: r.product_id, status: r.status })),
      razorpay: razorpayReports.map((r) => ({ id: r.product_id, status: r.status })),
    },
  })

  return NextResponse.json({
    stripe: stripeReports,
    razorpay: razorpayReports,
  })
}
