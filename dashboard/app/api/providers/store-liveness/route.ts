export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { checkPlayAppLive, checkAppStoreAppLive, type StoreLiveness } from "@/lib/store-liveness"

/**
 * Is this tenant's app actually LIVE on each store?
 *
 * Neither store will make a product purchasable until the APP is published, and both
 * report that as an opaque provider error — Play's 400 "The app is not published." reads
 * identically to a bad package name or a service account missing the subscriptions
 * permission. This route answers the question directly by probing the PUBLIC storefront,
 * the same listing a customer's device resolves, so the dashboard can say "publish your
 * app" instead of "sync failed".
 *
 * Only the non-secret `config` is read (package_name / bundle_id) via
 * `tenant_providers_store_status` — no credential is decrypted, because liveness is a
 * public fact and this endpoint should not touch key material to establish it.
 *
 * A store the tenant has not connected is reported `connected: false` with no verdict,
 * which is distinct from a connected store whose app is unpublished.
 */
interface StoreReport {
  connected: boolean
  /** The identifier we probed, when there is one. */
  id: string | null
  liveness: StoreLiveness | null
  /** Why no verdict is present (not connected / no id configured). */
  reason?: string
}

async function storeReport(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  provider: "google_play" | "app_store",
): Promise<StoreReport> {
  const { data: status } = await supabase
    .rpc("tenant_providers_store_status", { p_tenant_id: tenantId, p_provider: provider })
    .single<{ connected: boolean; config: Record<string, any> }>()

  if (!status?.connected) {
    return {
      connected: false,
      id: null,
      liveness: null,
      reason:
        provider === "google_play"
          ? "Google Play is not connected for this tenant"
          : "App Store is not connected for this tenant",
    }
  }

  const id =
    provider === "google_play" ? status.config?.package_name : status.config?.bundle_id
  if (!id) {
    return {
      connected: true,
      id: null,
      liveness: null,
      reason:
        provider === "google_play"
          ? "no package_name configured in Google Play store config"
          : "no bundle_id configured in App Store store config",
    }
  }

  const liveness =
    provider === "google_play"
      ? await checkPlayAppLive(id)
      : await checkAppStoreAppLive(id)
  return { connected: true, id, liveness }
}

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  // Both stores are probed concurrently — they are independent public endpoints and a
  // slow/unreachable one must not add its timeout to the other's.
  const [googlePlay, appStore] = await Promise.all([
    storeReport(supabase, tenant.id, "google_play"),
    storeReport(supabase, tenant.id, "app_store"),
  ])

  return NextResponse.json({
    google_play: googlePlay,
    app_store: appStore,
    // True only when a CONNECTED store has a confirmed-unpublished app — the state that
    // blocks activation and needs operator action. `unknown` never sets this.
    blocks_activation:
      googlePlay.liveness?.status === "not-published" ||
      appStore.liveness?.status === "not-published",
  })
}
