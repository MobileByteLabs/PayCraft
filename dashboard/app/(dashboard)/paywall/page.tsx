import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
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

  const canRemoveAttribution =
    Array.isArray(tier?.entitlements) &&
    (tier!.entitlements as string[]).includes("remove_attribution")

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Paywall designer</h1>
      <p className="text-sm text-gray-500 mb-6">
        Pick a template + theme — the SDK renders this directly. Changes go
        live on the next config fetch (max 1h cached).
      </p>
      <PaywallDesigner
        initial={
          paywall ?? {
            tenant_id: tenant.id,
            template: "minimal",
            theme_jsonb: {},
            branding: "attribution",
            custom_footer: null,
            primary_color: "#6B4FE3",
            font_family: "Inter",
            support_email: tenant.owner_email,
          }
        }
        canRemoveAttribution={canRemoveAttribution}
        plan={tenant.plan}
      />
    </div>
  )
}
