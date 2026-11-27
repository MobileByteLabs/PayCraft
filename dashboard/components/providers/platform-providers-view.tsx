"use client"

import { useQuery } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { PROVIDER_CONNECTED_COLUMNS, connectedProviderIds } from "@/lib/provider-connected"
import { PageHeader } from "@/components/ui/page-header"
import { PlatformProvidersPanel } from "@/components/providers/platform-providers-panel"
import { QueryError, QueryLoading, unwrap } from "@/components/providers/query-state"

/**
 * Platform providers — a first-class CONFIGURE page (sidebar item) for the per-platform provider
 * selector. Picks which provider each app platform (iOS / Android / Desktop / Web) uses, with fees
 * shown, backed by the migration-075 routing engine. iOS/Android digital is handled by the native
 * store automatically; Desktop/Web are routable.
 */
export function PlatformProvidersView() {
  const { tenantId, supabase } = useDashboard()
  const query = useQuery({
    queryKey: ["providers", tenantId, "platform"],
    queryFn: async () => {
      const [providersRes, registryRes, routingRes] = await Promise.all([
        // A ROW IS NOT A CONNECTION — see lib/provider-connected. Only non-secret columns are
        // selected: key_id is a public identifier and store_config holds package_name / bundle_id.
        supabase.from("tenant_providers").select(PROVIDER_CONNECTED_COLUMNS).eq("tenant_id", tenantId),
        supabase
          .from("provider_method_registry")
          .select("method, provider, display_name, fee_percent")
          .order("fee_percent"),
        supabase.rpc("tenant_routing_rules_list", { p_tenant_id: tenantId }),
      ])
      return {
        connectedProviders: connectedProviderIds(unwrap(providersRes) as any),
        registry: (unwrap(registryRes) ?? []) as any[],
        rules: (unwrap(routingRes) ?? []) as any[],
      }
    },
  })

  return (
    <div>
      <PageHeader
        title="Platform providers"
        subtitle="For each platform, pick a primary provider and an optional fallback used when the primary can't serve a customer. iOS and Android digital subscriptions always use the native store."
      />
      {query.isPending ? (
        <QueryLoading label="Loading platform providers…" />
      ) : query.isError ? (
        <QueryError what="platform providers" error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <PlatformProvidersPanel
          registry={query.data.registry}
          connectedProviders={query.data.connectedProviders}
          initialRules={query.data.rules}
        />
      )}
    </div>
  )
}
