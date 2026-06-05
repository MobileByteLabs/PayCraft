import Link from "next/link"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export default async function BillingPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [tierRes, usageRes, webhookRes, productsRes] = await Promise.all([
    supabase
      .from("tier_definitions")
      .select("*")
      .eq("tier_name", tenant.plan)
      .single(),
    supabase
      .from("tenant_subscriber_count_view")
      .select("active_count")
      .eq("tenant_id", tenant.id)
      .single(),
    supabase
      .from("tenant_webhook_delivery_view")
      .select("total,success_rate")
      .eq("tenant_id", tenant.id)
      .single(),
    supabase
      .from("tenant_products")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("active", true),
  ])

  const tier = tierRes.data
  const activeSubs = usageRes.data?.active_count ?? 0
  const webhookTotal = webhookRes.data?.total ?? 0
  const productCount = productsRes.count ?? 0

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
      <div className="flex items-center gap-3 mt-2 mb-8">
        <span className="px-3 py-1 rounded-full bg-brand-50 text-brand-700 text-xs font-semibold uppercase tracking-wider">
          {tier?.display_name ?? tenant.plan}
        </span>
        {tenant.plan !== "enterprise" && (
          <Link
            href="/billing/upgrade"
            className="rounded bg-brand-600 text-white px-4 py-1.5 text-sm font-medium hover:bg-brand-700"
          >
            Upgrade
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <UsageMeter
          label="Active subscribers"
          current={activeSubs}
          limit={tier?.max_active_subscribers ?? null}
        />
        <UsageMeter
          label="Webhook events (last 30 days)"
          current={webhookTotal}
          limit={tier?.max_webhook_events_per_month ?? null}
        />
        <UsageMeter
          label="Products"
          current={productCount}
          limit={tier?.max_products ?? null}
        />
        <UsageMeter
          label="Analytics retention"
          current={tier?.analytics_retention_days ?? 7}
          limit={null}
          formatCurrent={(n) => `${n} days`}
        />
      </div>

      <div className="mt-8 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Tier entitlements
        </h2>
        <ul className="text-sm text-gray-600 space-y-1">
          {[
            ["multi_provider", "Multiple payment providers (bottom sheet)"],
            ["remove_attribution", "Remove PayCraft attribution footer"],
            ["analytics_90day", "90-day analytics retention"],
            ["team_size_unlimited", "Unlimited dashboard team members"],
            ["custom_branding", "Custom paywall branding"],
            ["self_host_license", "Self-host Enterprise license"],
          ].map(([gate, label]) => {
            const enabled =
              Array.isArray(tier?.entitlements) &&
              (tier!.entitlements as string[]).includes(gate)
            return (
              <li key={gate} className="flex items-center gap-2">
                <span
                  className={`w-4 ${enabled ? "text-green-600" : "text-gray-300"}`}
                >
                  {enabled ? "✓" : "—"}
                </span>
                <span className={enabled ? "" : "text-gray-400"}>{label}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function UsageMeter({
  label,
  current,
  limit,
  formatCurrent = (n: number) => n.toLocaleString(),
}: {
  label: string
  current: number
  limit: number | null
  formatCurrent?: (n: number) => string
}) {
  const ratio = limit ? Math.min(1, current / limit) : 0
  const overWarn = limit && current >= limit * 0.8
  const overLimit = limit && current >= limit
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium text-gray-500 uppercase">{label}</div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-2xl font-semibold text-gray-900">
          {formatCurrent(current)}
        </span>
        <span className="text-sm text-gray-500">
          / {limit == null ? "unlimited" : limit.toLocaleString()}
        </span>
      </div>
      {limit && (
        <div className="mt-3 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              overLimit
                ? "bg-red-500"
                : overWarn
                ? "bg-amber-500"
                : "bg-brand-600"
            }`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
