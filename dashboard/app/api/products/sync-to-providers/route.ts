import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  stripeSyncProduct,
  razorpaySyncProduct,
  googlePlaySyncProduct,
  appStoreSyncProduct,
} from "@/lib/stripe-route-helper"

/**
 * Bulk re-sync of locally-saved products to the connected providers.
 *
 * Use case: the operator created tenant_products rows BEFORE connecting a
 * provider (Stripe / Razorpay for web PSPs, or Google Play / App Store for the
 * native billing lanes), so those rows lack stripe_product_id /
 * razorpay_plan_id_by_currency / play_product_id / app_store_product_id. Once a
 * provider is connected, this route pushes every "unsynced" product up to that
 * provider's API in sequence (idempotency keys in the *-product-sync helpers
 * make this safe to retry).
 *
 * GET — preview: returns counts of unsynced products per provider.
 * POST — execute: iterates the unsynced sets, runs the matching *SyncProduct
 *        helper for each, returns a per-product result array per provider.
 */
/**
 * Which providers are actually connected for this tenant. We only nag the
 * operator about unsynced products for providers they've wired up — otherwise
 * the banner would permanently complain about Razorpay / App Store drift on a
 * Stripe-only deployment, etc. Native stores are probed via
 * tenant_providers_store_status (the store-credential twin of
 * tenant_providers_status).
 */
async function providerConnections(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
): Promise<{
  stripe: boolean
  razorpay: boolean
  google_play: boolean
  app_store: boolean
}> {
  const [stripeStatus, razorpayStatus, playStatus, appStoreStatus] =
    await Promise.all([
      supabase
        .rpc("tenant_stripe_provider_status", { p_tenant_id: tenantId })
        .single<{ source: string | null }>(),
      supabase
        .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "razorpay" })
        .single<{ connected: boolean }>(),
      supabase
        .rpc("tenant_providers_store_status", { p_tenant_id: tenantId, p_provider: "google_play" })
        .single<{ connected: boolean }>(),
      supabase
        .rpc("tenant_providers_store_status", { p_tenant_id: tenantId, p_provider: "app_store" })
        .single<{ connected: boolean }>(),
    ])
  return {
    stripe: !!stripeStatus.data?.source,
    razorpay: !!razorpayStatus.data?.connected,
    google_play: !!playStatus.data?.connected,
    app_store: !!appStoreStatus.data?.connected,
  }
}

/**
 * Products still missing their native-store product id. There's no
 * tenant_products_unsynced branch for the stores (that RPC only knows
 * stripe/razorpay), so we probe tenant_products directly. Native stores only
 * apply to subscription products (the sync helpers self-skip non-subscriptions),
 * so we filter to type = 'subscription' + active here to mirror that contract
 * and keep the preview counts honest. Row shape matches the
 * tenant_products_unsynced RPC (id / sku / display_name) so downstream
 * consumers can treat every provider's items[] uniformly.
 */
async function storeUnsyncedRows(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  provider: "google_play" | "app_store",
): Promise<any[]> {
  const column =
    provider === "google_play" ? "play_product_id" : "app_store_product_id"
  const { data } = await supabase
    .from("tenant_products")
    .select("id, sku, display_name, type, interval, base_price_cents, base_currency")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .eq("type", "subscription")
    .is(column, null)
    .order("display_order")
    .order("created_at")
  return data ?? []
}

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const connected = await providerConnections(supabase, tenant.id)

  // Only probe unsynced products for connected providers — we don't want to
  // surface "4 not synced to Razorpay" when Razorpay isn't even configured.
  const [stripeRowsResp, razorpayRowsResp, playRowsResp, appStoreRowsResp] =
    await Promise.all([
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
      connected.google_play
        ? storeUnsyncedRows(supabase, tenant.id, "google_play")
        : Promise.resolve([] as any[]),
      connected.app_store
        ? storeUnsyncedRows(supabase, tenant.id, "app_store")
        : Promise.resolve([] as any[]),
    ])
  const stripeRows = stripeRowsResp.data ?? []
  const razorpayRows = razorpayRowsResp.data ?? []
  const playRows = playRowsResp ?? []
  const appStoreRows = appStoreRowsResp ?? []

  // Distinct-product count — the same row showing up in several lists shouldn't
  // be counted twice (banner shows "N products need sync", not "N sync ops").
  const uniqueIds = new Set<string>([
    ...stripeRows.map((r: any) => r.id),
    ...razorpayRows.map((r: any) => r.id),
    ...playRows.map((r: any) => r.id),
    ...appStoreRows.map((r: any) => r.id),
  ])

  return NextResponse.json({
    providers_connected: connected,
    unique_unsynced_count: uniqueIds.size,
    stripe: { unsynced_count: stripeRows.length, items: stripeRows },
    razorpay: { unsynced_count: razorpayRows.length, items: razorpayRows },
    google_play: { unsynced_count: playRows.length, items: playRows },
    app_store: { unsynced_count: appStoreRows.length, items: appStoreRows },
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
      "id, sku, type, display_name, interval, base_price_cents, base_currency, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency, play_product_id, app_store_product_id",
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

  const [stripeRowsResp, razorpayRowsResp, playRowsResp, appStoreRowsResp] =
    await Promise.all([
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
      connected.google_play
        ? storeUnsyncedRows(supabase, tenant.id, "google_play")
        : Promise.resolve([] as any[]),
      connected.app_store
        ? storeUnsyncedRows(supabase, tenant.id, "app_store")
        : Promise.resolve([] as any[]),
    ])
  const stripeRows = stripeRowsResp.data ?? []
  const razorpayRows = razorpayRowsResp.data ?? []
  const playRows = playRowsResp ?? []
  const appStoreRows = appStoreRowsResp ?? []

  const allIds = [
    ...((stripeRows ?? []) as any[]).map((r) => r.id),
    ...((razorpayRows ?? []) as any[]).map((r) => r.id),
    ...((playRows ?? []) as any[]).map((r) => r.id),
    ...((appStoreRows ?? []) as any[]).map((r) => r.id),
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

  // Native stores — the helpers self-skip non-subscription products + tenants
  // that haven't stored store credentials, and write play_product_id /
  // app_store_product_id back on success. "ok" = the id landed on the row.
  const googlePlayReports: SyncReport[] = []
  for (const row of (playRows ?? []) as any[]) {
    const body = bodies[row.id]
    if (!body) {
      googlePlayReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: "skipped",
        message: "product row not found during hydration",
      })
      continue
    }
    try {
      await googlePlaySyncProduct(supabase, {
        tenantId: tenant.id,
        productId: row.id,
        body,
        existingPlayProductId: body.play_product_id ?? undefined,
      })
      const { data: after } = await supabase
        .from("tenant_products")
        .select("play_product_id")
        .eq("id", row.id)
        .single()
      if (after?.play_product_id) {
        googlePlayReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "ok",
        })
      } else {
        googlePlayReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "failed",
          message:
            "sync helper returned without populating play_product_id — check that google_play credentials + package_name are configured (server logs carry the Play API error)",
        })
      }
    } catch (e: any) {
      googlePlayReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: "failed",
        message: e?.message ?? String(e),
      })
    }
  }

  const appStoreReports: SyncReport[] = []
  for (const row of (appStoreRows ?? []) as any[]) {
    const body = bodies[row.id]
    if (!body) {
      appStoreReports.push({
        product_id: row.id,
        sku: row.sku,
        display_name: row.display_name,
        status: "skipped",
        message: "product row not found during hydration",
      })
      continue
    }
    try {
      await appStoreSyncProduct(supabase, {
        tenantId: tenant.id,
        productId: row.id,
        body,
        existingAppStoreProductId: body.app_store_product_id ?? undefined,
      })
      const { data: after } = await supabase
        .from("tenant_products")
        .select("app_store_product_id")
        .eq("id", row.id)
        .single()
      if (after?.app_store_product_id) {
        appStoreReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "ok",
        })
      } else {
        appStoreReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "failed",
          message:
            "sync helper returned without populating app_store_product_id — check that app_store credentials (key_id/issuer_id/bundle_id + .p8) are configured (server logs carry the ASC API error)",
        })
      }
    } catch (e: any) {
      appStoreReports.push({
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
      google_play: googlePlayReports.map((r) => ({ id: r.product_id, status: r.status })),
      app_store: appStoreReports.map((r) => ({ id: r.product_id, status: r.status })),
    },
  })

  return NextResponse.json({
    stripe: stripeReports,
    razorpay: razorpayReports,
    google_play: googlePlayReports,
    app_store: appStoreReports,
  })
}
