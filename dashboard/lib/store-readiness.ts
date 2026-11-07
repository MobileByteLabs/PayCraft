import type { SupabaseClient } from "@supabase/supabase-js"
import { appStoreSubscriptionReadiness } from "@/lib/appstore-readiness"
import { googlePlaySubscriptionReadiness } from "@/lib/googleplay-readiness"

/**
 * Are the native-store products actually SELLABLE? Asked of the STORES, per store.
 *
 * Shared by GET /api/products/store-readiness (cookie session, user client) and
 * GET /api/v1/products/store-readiness (API key, service-role client after requireApiKey resolved
 * the tenant). One implementation, so the MCP answer and the dashboard answer cannot disagree.
 * The store RPCs used here accept service_role since migrations 138/139.
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

export async function computeStoreReadiness(client: SupabaseClient<any>, tenantId: string) {

  const { data: rawProducts } = await client
    .from("tenant_products")
    .select(
      "id, sku, type, app_store_product_id, play_product_id, trial_enabled, trial_duration_days, trial_per_platform, stripe_price_id_by_currency",
    )
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("display_order")

  // Trials are not separately purchasable; they ship as an offer ON a paid subscription, so asking
  // a store about them would always report a phantom gap.
  const products = ((rawProducts ?? []) as ProductRow[]).filter((p) => p.type !== "trial")

  const stores: Record<string, { applicable: boolean; ready: boolean; reason?: string }> = {}
  const all: Array<Record<string, unknown>> = []

  // ── App Store ──────────────────────────────────────────────────────────────────────────────────
  const { data: asStatus } = await client
    .rpc("tenant_providers_store_status", { p_tenant_id: tenantId, p_provider: "app_store" })
    .single<{ connected: boolean }>()

  if (!asStatus?.connected) {
    stores.app_store = { applicable: false, ready: true, reason: "App Store is not connected for this tenant" }
  } else {
    const { data: dec } = await client
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenantId, p_provider: "app_store" })
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
  const { data: gpStatus } = await client
    .rpc("tenant_providers_store_status", { p_tenant_id: tenantId, p_provider: "google_play" })
    .single<{ connected: boolean }>()

  if (!gpStatus?.connected) {
    stores.google_play = { applicable: false, ready: true, reason: "Google Play is not connected for this tenant" }
  } else {
    const { data: dec } = await client
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenantId, p_provider: "google_play" })
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
  return {
    applicable,
    ready: Object.values(stores).every((s) => s.ready),
    reason: Object.values(stores).find((s) => s.applicable && s.reason)?.reason,
    stores,
    products: all,
  }
}
