"use client"

import Link from "next/link"
import { ArrowLeft, Info } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { PROVIDER_CONNECTED_COLUMNS, connectedProviderIds } from "@/lib/provider-connected"
import { RoutingRulesEditor } from "@/components/providers/routing-rules-editor"
import { QueryError, QueryLoading, unwrap } from "@/components/providers/query-state"

/**
 * Smart routing rules editor.
 *
 * Default behavior (no rules): the router picks the CHEAPEST eligible
 * method per (country, currency, product_type) tuple. This page lets the
 * merchant override that — "for IN + INR + subscription, prefer
 * razorpay over the cheaper direct_upi because subscription needs
 * UPI Autopay which only PSPs can issue".
 *
 * Each rule is a sieve: match on country / currency / product_type
 * (any NULL = wildcard), then try the ordered priority_methods until one
 * is enabled + eligible. First matching rule wins; rules tried in
 * ascending `priority` order (lower = higher precedence).
 */
export function RoutingRulesView() {
  const { tenantId, supabase } = useDashboard()
  const query = useQuery({
    queryKey: ["providers", tenantId, "routing"],
    queryFn: async () => {
      const [rulesRes, registryRes, methodsRes, providersRes] = await Promise.all([
        supabase.rpc("tenant_routing_rules_list", { p_tenant_id: tenantId }),
        supabase
          .from("provider_method_registry")
          .select(
            "method, display_name, provider, fee_percent, supports_one_time, supports_subscription, supported_countries, supported_currencies",
          )
          .order("fee_percent"),
        supabase.rpc("tenant_payment_methods_list", { p_tenant_id: tenantId }),
        supabase.from("tenant_providers").select(PROVIDER_CONNECTED_COLUMNS).eq("tenant_id", tenantId),
      ])
      const methods = (unwrap(methodsRes) ?? []) as any[]
      return {
        rules: (unwrap(rulesRes) ?? []) as any[],
        registry: (unwrap(registryRes) ?? []) as any[],
        connectedMethods: [...new Set<string>(methods.filter((m) => m.enabled).map((m) => m.method as string))],
        connectedProviders: connectedProviderIds(unwrap(providersRes) as any),
      }
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/providers"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to providers
        </Link>
        <h1 className="text-2xl font-bold text-ink-900">Smart routing</h1>
        <p className="text-sm text-ink-500 mt-1 max-w-3xl">
          Override the default "cheapest eligible method" picker with
          per-(country, currency, product type, platform) priority rules — set a
          rule's <strong>platform</strong> to steer providers per app platform
          (e.g. Stripe on desktop, Razorpay on Android), or leave it "Any". Each
          rule is tried in priority order; first match wins. Leave a field blank
          to match everything.
        </p>
      </div>

      <div className="bg-brand-50 border border-brand-200 rounded-xl p-4 flex items-start gap-2">
        <Info className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-brand-900 leading-relaxed">
          <strong>No rules yet?</strong> That's fine — the router defaults to
          picking the cheapest connected method that supports the customer's
          (country, currency, product type) tuple. Add rules only when you
          need to override that (e.g. "always use Razorpay UPI for IN
          subscriptions even if a cheaper method exists").
        </div>
      </div>

      {query.isPending ? (
        <QueryLoading label="Loading routing rules…" />
      ) : query.isError ? (
        <QueryError what="routing rules" error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <RoutingRulesEditor
          initialRules={query.data.rules}
          registry={query.data.registry}
          connectedMethods={query.data.connectedMethods}
          connectedProviders={query.data.connectedProviders}
        />
      )}
    </div>
  )
}