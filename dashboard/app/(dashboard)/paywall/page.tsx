export const runtime = "edge"

import Link from "next/link"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { PaywallDesigner } from "@/components/paywall/paywall-designer"

export default async function PaywallPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data: paywall } = await supabase.rpc("tenant_paywall_get", {
    p_tenant_id: tenant.id,
  })
  const { data: tier } = await supabase
    .from("tier_definitions")
    .select("entitlements,attribution_required")
    .eq("tier_name", tenant.plan)
    .single()
  const { data: products } = await supabase
    .from("tenant_products")
    .select(
      "id,sku,type,display_name,interval,base_price_cents,base_currency,display_order,trial_duration_days,attaches_to_product_id",
    )
    .eq("tenant_id", tenant.id)
    .eq("active", true)
    .order("display_order")

  const canRemoveAttribution =
    Array.isArray(tier?.entitlements) &&
    (tier!.entitlements as string[]).includes("remove_attribution")

  return (
    <div>
      <PageHeader
        title="Paywall designer"
        subtitle="Pick a template + theme — the SDK renders this directly. Changes reach devices within the SDK's cache TTL (5 min by default)."
        badge={
          <Badge tone="info" dot>
            Live preview
          </Badge>
        }
      />
      {/* The gallery is a sibling page rather than a modal: applying a template rewrites the draft,
          which is a navigation-worthy action, and a URL makes it linkable from docs and support. */}
      <div className="mb-6">
        <Link
          href="/paywall/templates"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Browse paywall templates →
        </Link>
        <Link
          href="/paywall/designer"
          className="ml-2 inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          Open tree editor →
        </Link>
      </div>
      <PaywallDesigner
        initial={
          paywall ?? {
            tenant_id: tenant.id,
            template: "minimal",
            theme_jsonb: {},
            branding: "attribution",
            custom_footer: null,
            primary_color: "#7C3AED",
            font_family: "Inter",
            support_email: tenant.owner_email,
          }
        }
        products={products ?? []}
        canRemoveAttribution={canRemoveAttribution}
        plan={tenant.plan}
      />
    </div>
  )
}