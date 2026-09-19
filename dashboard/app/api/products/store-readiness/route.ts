export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { appStoreSubscriptionReadiness } from "@/lib/appstore-readiness"
import { googlePlaySubscriptionReadiness } from "@/lib/googleplay-readiness"

/**
 * Are the native-store products actually SELLABLE? Asked of the STORES, per store.
 *
 * This deliberately does NOT consult `app_store_product_id` / `play_product_id` beyond needing them
 * to look a product up. A local identifier records that a sync call once succeeded; it says nothing
 * about whether the store considers the product complete. Conflating the two let three App Store
 * subscriptions sit in MISSING_METADATA while every surface reported a clean sync.
 *
 * Each store is reported independently and only when connected: an Android-only tenant must not be
 * failed for an App Store it does not ship to, and vice versa.
 *
 * Returns 200 even when not ready — "the store is not ready" is a successful ANSWER, and an error
 * status would make callers treat it as a transport failure and retry.
 */

type ProductRow = {
  id: string
  sku: string
  type: string | null
  app_store_product_id: string | null
  play_product_id: string | null
  trial_enabled: boolean | null
  trial_duration_days: number | null
  trial_per_platform: Record<string, number> | null
  stripe_price_id_by_currency: Record<string, string> | null
}

/** Trial days that apply on one platform, honouring a per-platform override of 0 (means: none). */
function trialDaysFor(p: ProductRow, platform: "ios" | "android"): number | null {
  const per = p.trial_per_platform
  if (per && Object.prototype.hasOwnProperty.call(per, platform)) return Number(per[platform]) || 0
  if (!p.trial_enabled) return 0
  return p.trial_duration_days ?? 0
}

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: rawProducts } = await supabase
    .from("tenant_products")
    .select(
      "id, sku, type, app_store_product_id, play_product_id, trial_enabled, trial_duration_days, trial_per_platform, stripe_price_id_by_currency",
    )
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("display_order")

  // Trials are not separately purchasable; they ship as an offer ON a paid subscription, so asking
  // a store about them would always report a phantom gap.
  const products = ((rawProducts ?? []) as ProductRow[]).filter((p) => p.type !== "trial")

  const stores: Record<string, { applicable: boolean; ready: boolean; reason?: string }> = {}
  const all: Array<Record<string, unknown>> = []

  // ── App Store ──────────────────────────────────────────────────────────────────────────────────
  const { data: asStatus } = await supabase
    .rpc("tenant_providers_store_status", { p_tenant_id: tenant.id, p_provider: "app_store" })
    .single<{ connected: boolean }>()

  if (!asStatus?.connected) {
    stores.app_store = { applicable: false, ready: true, reason: "App Store is not connected for this tenant" }
  } else {
    const { data: dec } = await supabase
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenant.id, p_provider: "app_store" })
      .single<{ credential: string | null; config: Record<string, string> }>()
    const cfg = dec?.config ?? {}
    if (!dec?.credential || !cfg.key_id || !cfg.issuer_id || !cfg.bundle_id) {
      stores.app_store = {
        applicable: true,
        ready: false,
        reason: "missing key_id/issuer_id/bundle_id or .p8 in App Store store config",
      }
    } else {
      const rows = await appStoreSubscriptionReadiness(
        { keyId: cfg.key_id, issuerId: cfg.issuer_id, privateKeyP8: dec.credential, bundleId: cfg.bundle_id },
        products.map((p) => ({ id: p.id, sku: p.sku, appStoreProductId: p.app_store_product_id })),
      )
      stores.app_store = { applicable: true, ready: rows.every((r) => r.ready) }
      all.push(...rows.map((r) => ({ store: "app_store", warnings: [], ...r })))
    }
  }

  // ── Google Play ────────────────────────────────────────────────────────────────────────────────
  const { data: gpStatus } = await supabase
    .rpc("tenant_providers_store_status", { p_tenant_id: tenant.id, p_provider: "google_play" })
    .single<{ connected: boolean }>()

  if (!gpStatus?.connected) {
    stores.google_play = { applicable: false, ready: true, reason: "Google Play is not connected for this tenant" }
  } else {
    const { data: dec } = await supabase
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenant.id, p_provider: "google_play" })
      .single<{ credential: string | null; config: Record<string, string> }>()
    const pkg = dec?.config?.package_name
    if (!dec?.credential || !pkg) {
      stores.google_play = {
        applicable: true,
        ready: false,
        reason: "missing package_name or service-account JSON in Google Play store config",
      }
    } else {
      const rows = await googlePlaySubscriptionReadiness(
        { serviceAccountJson: dec.credential, packageName: pkg },
        products.map((p) => ({
          id: p.id,
          sku: p.sku,
          playProductId: p.play_product_id,
          androidTrialDays: trialDaysFor(p, "android"),
          configuredCurrencies: Object.keys(p.stripe_price_id_by_currency ?? {}).length,
        })),
      )
      stores.google_play = { applicable: true, ready: rows.every((r) => r.ready) }
      all.push(...rows.map((r) => ({ store: "google_play", ...r })))
    }
  }

  const applicable = Object.values(stores).some((s) => s.applicable)
  return NextResponse.json({
    applicable,
    ready: Object.values(stores).every((s) => s.ready),
    reason: Object.values(stores).find((s) => s.applicable && s.reason)?.reason,
    stores,
    products: all,
  })
}
