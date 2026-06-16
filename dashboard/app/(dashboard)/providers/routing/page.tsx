import Link from "next/link"
import { ArrowLeft, Info } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { RoutingRulesEditor } from "@/components/providers/routing-rules-editor"

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
export default async function RoutingRulesPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [rulesRes, registryRes, methodsRes, providersRes] = await Promise.all([
    supabase.rpc("tenant_routing_rules_list", { p_tenant_id: tenant.id }),
    supabase
      .from("provider_method_registry")
      .select(
        "method, display_name, provider, fee_percent, supports_one_time, supports_subscription, supported_countries, supported_currencies",
      )
      .order("fee_percent"),
    supabase.rpc("tenant_payment_methods_list", { p_tenant_id: tenant.id }),
    supabase
      .from("tenant_providers")
      .select("provider")
      .eq("tenant_id", tenant.id),
  ])

  const rules = rulesRes.data ?? []
  const registry = registryRes.data ?? []
  const tenantMethods = new Set<string>(
    (methodsRes.data ?? [])
      .filter((m: any) => m.enabled)
      .map((m: any) => m.method as string),
  )
  const tenantProviders = new Set<string>(
    (providersRes.data ?? []).map((r: any) => r.provider as string),
  )

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
          per-(country, currency, product type) priority rules. Each rule is
          tried in priority order; first match wins. Leave a field blank to
          match everything.
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

      <RoutingRulesEditor
        initialRules={rules}
        registry={registry}
        connectedMethods={[...tenantMethods]}
        connectedProviders={[...tenantProviders]}
      />
    </div>
  )
}
