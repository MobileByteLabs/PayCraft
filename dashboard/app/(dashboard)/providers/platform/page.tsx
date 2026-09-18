export const runtime = "edge"

import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PROVIDER_CONNECTED_COLUMNS, connectedProviderIds } from "@/lib/provider-connected"
import { PageHeader } from "@/components/ui/page-header"
import { PlatformProvidersPanel } from "@/components/providers/platform-providers-panel"

/**
 * Platform providers — a first-class CONFIGURE page (sidebar item) for the per-platform provider
 * selector. Picks which provider each app platform (iOS / Android / Desktop / Web) uses, with fees
 * shown, backed by the migration-075 routing engine. iOS/Android digital is handled by the native
 * store automatically; Desktop/Web are routable.
 */
export default async function PlatformProvidersPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [providersRes, registryRes, routingRes] = await Promise.all([
    // A ROW IS NOT A CONNECTION. This used to select only `provider` with no filter, so any row in
    // tenant_providers rendered as "Connected" — including rows written with is_active = true and no
    // credential at all, which is what an interrupted or preview-mode onboarding leaves behind. The
    // Products page reads the credential and greys the same provider, so the two pages disagreed and
    // this one was the optimistic liar.
    //
    // Only non-secret columns are selected: key_id is a public identifier (rzp_live_…, pk_live_…)
    // and store_config holds package_name / bundle_id. The encrypted secret columns are never
    // pulled — their presence is implied by the key_id the same save writes.
    supabase
      .from("tenant_providers")
      .select(PROVIDER_CONNECTED_COLUMNS)
      .eq("tenant_id", tenant.id),
    supabase
      .from("provider_method_registry")
      .select("method, provider, display_name, fee_percent")
      .order("fee_percent"),
    supabase.rpc("tenant_routing_rules_list", { p_tenant_id: tenant.id }),
  ])

  const connectedProviders = connectedProviderIds(providersRes.data as any)

  return (
    <div>
      <PageHeader
        title="Platform providers"
        subtitle="For each platform, pick a primary provider and an optional fallback used when the primary can't serve a customer. iOS and Android digital subscriptions always use the native store."
      />
      <PlatformProvidersPanel
        registry={(registryRes.data ?? []) as any}
        connectedProviders={connectedProviders}
        initialRules={(routingRes.data ?? []) as any}
      />
    </div>
  )
}