export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  stripeSyncProduct,
  razorpaySyncProduct,
  googlePlaySyncProduct,
  appStoreSyncProduct,
  classifyProvider,
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

// Native-store unsynced probing now flows through tenant_products_needs_sync
// (migration 078) — which covers null store-id AND non-terminal/failed/draft sync
// state — so the old per-store null-id probe (storeUnsyncedRows) was removed.

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const connected = await providerConnections(supabase, tenant.id)

  // Only probe unsynced products for connected providers — we don't want to
  // surface "4 not synced to Razorpay" when Razorpay isn't even configured.
  // tenant_products_needs_sync (migration 078) is a superset of the old null-id
  // heuristic: it also returns products whose recorded sync_status is non-terminal
  // (an interrupted "save for later" run) OR whose per-provider state is failed/
  // draft (e.g. base plan synced but the FREE_TRIAL offer failed) — which the
  // null-id check could never see.
  const needsSync = (provider: string) =>
    supabase.rpc("tenant_products_needs_sync", { p_tenant_id: tenant.id, p_provider: provider })
  const [stripeRowsResp, razorpayRowsResp, playRowsResp, appStoreRowsResp] =
    await Promise.all([
      connected.stripe ? needsSync("stripe") : Promise.resolve({ data: [] }),
      connected.razorpay ? needsSync("razorpay") : Promise.resolve({ data: [] }),
      connected.google_play ? needsSync("google_play") : Promise.resolve({ data: [] }),
      connected.app_store ? needsSync("app_store") : Promise.resolve({ data: [] }),
    ])
  const stripeRows = stripeRowsResp.data ?? []
  const razorpayRows = razorpayRowsResp.data ?? []
  const playRows = playRowsResp.data ?? []
  const appStoreRows = appStoreRowsResp.data ?? []

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
  /**
   * `draft` = the provider accepted the product but it is NOT purchasable yet (a Play base plan
   * awaiting activation, which Play blocks until the app is published). Collapsing that into `ok`
   * is what let a product report "synced" while the store refused to sell it.
   */
  status: "ok" | "draft" | "failed" | "skipped"
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
      "id, sku, type, display_name, interval, base_price_cents, base_currency, trial_enabled, trial_duration_days, trial_per_platform, stripe_product_id, stripe_price_id_by_currency, razorpay_plan_id_by_currency, play_product_id, app_store_product_id",
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

  // tenant_products_needs_sync (migration 078) is a superset of the old null-id
  // heuristic: it also returns products whose recorded sync_status is non-terminal
  // (an interrupted "save for later" run) OR whose per-provider state is failed/
  // draft (e.g. base plan synced but the FREE_TRIAL offer failed) — which the
  // null-id check could never see.
  const needsSync = (provider: string) =>
    supabase.rpc("tenant_products_needs_sync", { p_tenant_id: tenant.id, p_provider: provider })
  const [stripeRowsResp, razorpayRowsResp, playRowsResp, appStoreRowsResp] =
    await Promise.all([
      connected.stripe ? needsSync("stripe") : Promise.resolve({ data: [] }),
      connected.razorpay ? needsSync("razorpay") : Promise.resolve({ data: [] }),
      connected.google_play ? needsSync("google_play") : Promise.resolve({ data: [] }),
      connected.app_store ? needsSync("app_store") : Promise.resolve({ data: [] }),
    ])
  const stripeRows = stripeRowsResp.data ?? []
  const razorpayRows = razorpayRowsResp.data ?? []
  const playRows = playRowsResp.data ?? []
  const appStoreRows = appStoreRowsResp.data ?? []

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
      const res = await stripeSyncProduct(supabase, {
        tenantId: tenant.id,
        productId: row.id,
        body,
        existingStripeProductId: body.stripe_product_id ?? undefined,
        existingPrices: body.stripe_price_id_by_currency ?? undefined,
      })
      // `stripeSyncProduct` returns structured status ({ok,skipped,error,reason}); the
      // return value used to be DISCARDED here and the outcome inferred from whether
      // stripe_product_id came back populated. That inference mislabels the commonest
      // case: a tenant who simply has not connected Stripe returns {skipped, reason} and
      // was reported as a red `failed` blaming "missing/invalid Stripe credentials".
      const entry = classifyProvider(res)
      const { data: after } = await supabase
        .from("tenant_products")
        .select("stripe_product_id")
        .eq("id", row.id)
        .single()
      if (entry.status === "skipped") {
        stripeReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "skipped",
          message: entry.reason,
        })
      } else if (after?.stripe_product_id) {
        stripeReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: entry.status === "synced" ? "ok" : entry.status === "draft" ? "draft" : "failed",
          message: entry.reason ?? entry.warning,
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
      const res = await googlePlaySyncProduct(supabase, {
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
        // Classify with the SHARED classifier, not an id-presence heuristic.
        //
        // This branch used to report `status: "ok"` whenever play_product_id was written and file
        // the DRAFT warning as a cosmetic `message`. A base plan that Play refused to activate is
        // NOT purchasable, so the durable sync_state recorded `synced` for a product that could not
        // be sold — measured on mbs/cappy 2026-09-17, where the device got "Product not found on
        // Play" for a row whose sync_state read {"status":"synced"} with no reason.
        //
        // `runProductSync` already maps !activated -> warning -> classifyProvider -> "draft" with a
        // reason. Duplicating the decision here is what let the two paths disagree; this defers to
        // the one that is right.
        const entry = classifyProvider(res)
        googlePlayReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: entry.status === "synced" ? "ok" : entry.status === "draft" ? "draft" : "failed",
          message: entry.reason ?? entry.warning,
        })
      } else {
        googlePlayReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "failed",
          message:
            res.error ??
            "sync helper returned without populating play_product_id — check that google_play credentials + package_name are configured",
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
      const res = await appStoreSyncProduct(supabase, {
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
        // Same shared classifier as the Play branch above — and the App Store case is the
        // sharper one: `appStoreSyncProduct` writes app_store_product_id via
        // tenant_products_set_store_ids BEFORE it returns `{error}` for a free-trial offer
        // that failed to provision. So an id-presence check reports a HARD ERROR as "ok",
        // discarding the reason entirely. Deferring to classifyProvider makes this drain
        // agree with the single-product path instead of contradicting it.
        const entry = classifyProvider(res)
        appStoreReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status:
            entry.status === "synced"
              ? "ok"
              : entry.status === "draft"
                ? "draft"
                : entry.status === "skipped"
                  ? "skipped"
                  : "failed",
          message: entry.reason ?? entry.warning,
        })
      } else {
        appStoreReports.push({
          product_id: row.id,
          sku: row.sku,
          display_name: row.display_name,
          status: "failed",
          message:
            res.error ??
            "sync helper returned without populating app_store_product_id — check that app_store credentials (key_id/issuer_id/bundle_id + .p8) are configured",
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