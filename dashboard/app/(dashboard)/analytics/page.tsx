import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { AnalyticsCharts } from "./analytics-charts"

export default async function AnalyticsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  // MRR
  const { data: mrr } = await supabase
    .from("mv_tenant_mrr")
    .select("*")
    .eq("tenant_id", tenant.id)

  const mrrCents = mrr?.[0]?.mrr_cents ?? 0
  const activeCount = mrr?.[0]?.active_subscribers ?? 0

  // Subscriber cohorts (last 12 months)
  const { data: cohorts } = await supabase
    .from("mv_subscriber_cohorts")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("cohort_month", { ascending: true })

  // Churn by month
  const { data: churn } = await supabase
    .from("mv_churn_by_month")
    .select("*")
    .eq("tenant_id", tenant.id)
    .order("churn_month", { ascending: true })

  // Status breakdown
  const { data: statusBreakdown } = await supabase
    .from("subscriptions")
    .select("status")
    .eq("tenant_id", tenant.id)
    .eq("mode", "live")

  const statusCounts: Record<string, number> = {}
  statusBreakdown?.forEach((s: { status: string }) => {
    statusCounts[s.status] = (statusCounts[s.status] || 0) + 1
  })

  // Plan breakdown
  const { data: planBreakdown } = await supabase
    .from("subscriptions")
    .select("plan")
    .eq("tenant_id", tenant.id)
    .eq("mode", "live")
    .in("status", ["active", "trialing"])

  const planCounts: Record<string, number> = {}
  planBreakdown?.forEach((s: { plan: string }) => {
    planCounts[s.plan] = (planCounts[s.plan] || 0) + 1
  })

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Analytics</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <KpiCard
          label="Monthly Recurring Revenue"
          value={`$${(mrrCents / 100).toFixed(2)}`}
        />
        <KpiCard
          label="Active Subscribers"
          value={activeCount.toLocaleString()}
        />
        <KpiCard
          label="Churn (This Month)"
          value={String(churn?.find((c: any) =>
            new Date(c.churn_month).getMonth() === new Date().getMonth()
          )?.churned_count ?? 0)}
        />
      </div>

      <AnalyticsCharts
        cohorts={cohorts ?? []}
        churn={churn ?? []}
        statusCounts={statusCounts}
        planCounts={planCounts}
      />
    </div>
  )
}

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
    </div>
  )
}
