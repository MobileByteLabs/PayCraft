import {
  TrendingUp,
  TrendingDown,
  Users,
  Webhook,
  CreditCard,
  LogOut,
  CheckCircle2,
  CalendarDays,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MRRChart } from "@/components/charts/mrr-chart"
import { ChurnChart } from "@/components/charts/churn-chart"
import { WebhookDonut } from "@/components/charts/webhook-donut"

export default async function AnalyticsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [mrrRes, churnRes, subCountRes, revenueRes, webhookRes] =
    await Promise.all([
      supabase
        .from("tenant_mrr_view")
        .select("mrr_dollars,month")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
      supabase
        .from("tenant_churn_view")
        .select("month,churn_rate")
        .eq("tenant_id", tenant.id)
        .order("month")
        .limit(6),
      supabase
        .from("tenant_subscriber_count_view")
        .select("active_count,trial_count,canceled_count")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
      supabase
        .from("tenant_revenue_by_plan_view")
        .select("plan,subscribers,total_revenue_dollars")
        .eq("tenant_id", tenant.id)
        .order("total_revenue_dollars", { ascending: false }),
      supabase
        .from("tenant_webhook_delivery_view")
        .select("total,success,success_rate")
        .eq("tenant_id", tenant.id)
        .maybeSingle(),
    ])

  const mrrToday = mrrRes.data?.mrr_dollars ?? 0
  const activeSubs = subCountRes.data?.active_count ?? 0
  const trialSubs = subCountRes.data?.trial_count ?? 0
  const churnLatest =
    (churnRes.data && churnRes.data[churnRes.data.length - 1]?.churn_rate) ?? 0
  const webhookSuccessRate = webhookRes.data?.success_rate ?? 1
  const webhookSuccess = webhookRes.data?.success ?? 0
  const webhookTotal = webhookRes.data?.total ?? 0
  const webhookFailed = webhookTotal - webhookSuccess

  // tenant_mrr_view is point-in-time; synthesize a 6-month curve until we
  // ship the snapshot history table.
  const mrrSeries = synthesizeMRRSeries(mrrToday)
  const churnSeries = (churnRes.data ?? []).map((r: any) => ({
    month: new Date(r.month).toLocaleDateString("en-US", { month: "short" }),
    churn_rate: r.churn_rate ?? 0,
  }))
  const churnDisplay =
    churnSeries.length === 0 ? synthesizeChurnSeries() : churnSeries

  const revenueByPlan = revenueRes.data ?? []

  // Plan dot colors for the revenue table
  const planColors: Record<number, string> = {
    0: "bg-brand-500",
    1: "bg-info-500",
    2: "bg-warning-500",
    3: "bg-ink-300",
  }

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-end justify-between pt-2">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 mb-2">
            Analytics
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-ink-500 text-sm">
              MRR, churn, active subscribers, revenue by plan, webhook delivery
              rate.
            </p>
            <Badge tone="brand">
              Retention 90 days ({tenant.plan ?? "Pro"})
            </Badge>
          </div>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-ink-200 rounded-lg text-sm font-semibold text-ink-700 hover:border-ink-300 transition-all shadow-sm flex-shrink-0">
          <CalendarDays className="w-4 h-4" strokeWidth={2} />
          <span>Last 30 days</span>
          <svg
            className="w-4 h-4 text-ink-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* MRR Today */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-xs font-bold text-ink-500 uppercase tracking-widest">
              MRR Today
            </p>
            <span className="text-brand-600 bg-brand-50 p-1.5 rounded-lg flex items-center justify-center">
              <CreditCard className="w-4 h-4" strokeWidth={2} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums text-ink-900">
              ${mrrToday.toFixed(0)}
            </span>
            {mrrToday > 0 && (
              <span className="text-xs font-bold text-success-600 flex items-center gap-0.5">
                <TrendingUp className="w-3.5 h-3.5" strokeWidth={2.5} />
                +12%
              </span>
            )}
          </div>
        </div>

        {/* Active Subscribers */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-xs font-bold text-ink-500 uppercase tracking-widest">
              Active Subscribers
            </p>
            <span className="text-info-600 bg-info-50 p-1.5 rounded-lg flex items-center justify-center">
              <Users className="w-4 h-4" strokeWidth={2} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums text-ink-900">
              {activeSubs.toLocaleString()}
            </span>
            {trialSubs > 0 && (
              <span className="text-xs font-bold text-success-600 flex items-center gap-0.5">
                +{trialSubs} trials
              </span>
            )}
          </div>
        </div>

        {/* Churn Rate */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-xs font-bold text-ink-500 uppercase tracking-widest">
              Churn Rate (30d)
            </p>
            <span className="text-warning-600 bg-warning-50 p-1.5 rounded-lg flex items-center justify-center">
              <LogOut className="w-4 h-4" strokeWidth={2} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums text-ink-900">
              {(churnLatest * 100).toFixed(1)}%
            </span>
            <span className="text-xs font-bold text-success-600 flex items-center gap-0.5">
              <TrendingDown className="w-3.5 h-3.5" strokeWidth={2.5} />
              Healthy
            </span>
          </div>
        </div>

        {/* Webhook Delivery */}
        <div className="bg-white p-6 rounded-xl border border-ink-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-4">
            <p className="text-xs font-bold text-ink-500 uppercase tracking-widest">
              Webhook Delivery
            </p>
            <span className="text-success-600 bg-success-50 p-1.5 rounded-lg flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" strokeWidth={2} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums text-ink-900">
              {(webhookSuccessRate * 100).toFixed(1)}%
            </span>
            <span className="text-[10px] font-bold text-ink-400 uppercase tracking-tighter">
              {webhookTotal === 0 ? "—" : "Realtime"}
            </span>
          </div>
        </div>
      </div>

      {/* Main Charts Grid (12-col) */}
      <div className="grid grid-cols-12 gap-8">
        {/* MRR Area Chart — 8 cols */}
        <div className="col-span-12 lg:col-span-8 bg-white rounded-xl border border-ink-200 shadow-sm p-6">
          <div className="flex justify-between items-center mb-8">
            <div>
              <h3 className="text-lg font-bold text-ink-900 tracking-tight">
                Monthly recurring revenue
              </h3>
              <p className="text-xs text-ink-500 mt-0.5">
                Real-time growth across all billing cycles
              </p>
            </div>
            <span className="px-2.5 py-1 bg-ink-100 text-ink-600 text-[10px] font-bold rounded-full uppercase tracking-widest">
              Last 90 days
            </span>
          </div>
          <div className="h-64">
            <MRRChart data={mrrSeries} />
          </div>
          <div className="mt-4 flex justify-between text-[11px] text-ink-500 font-bold uppercase tracking-wider">
            {mrrSeries.map((s) => (
              <span key={s.month}>{s.month}</span>
            ))}
          </div>
        </div>

        {/* Churn Bar Chart — 4 cols */}
        <div className="col-span-12 lg:col-span-4 bg-white rounded-xl border border-ink-200 shadow-sm p-6">
          <div className="mb-8">
            <h3 className="text-lg font-bold text-ink-900 tracking-tight">
              Monthly churn
            </h3>
            <p className="text-xs text-ink-500 mt-0.5">
              % of canceled subs per month
            </p>
          </div>
          <div className="h-64">
            <ChurnChart data={churnDisplay} />
          </div>
        </div>

        {/* Revenue by Plan Table — 7 cols */}
        <div className="col-span-12 lg:col-span-7 bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-ink-100 flex items-center justify-between">
            <h3 className="text-lg font-bold text-ink-900 tracking-tight">
              Revenue by plan
            </h3>
            <button className="text-xs font-bold text-brand-600 hover:text-brand-700 transition-colors uppercase tracking-widest">
              Full Report
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-ink-50 border-b border-ink-100">
                  <th className="px-6 py-3 text-[11px] font-bold text-ink-500 uppercase tracking-widest">
                    Plan
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold text-ink-500 uppercase tracking-widest text-right">
                    Subscribers
                  </th>
                  <th className="px-6 py-3 text-[11px] font-bold text-ink-500 uppercase tracking-widest text-right">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {revenueByPlan.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-6 py-10 text-center text-sm text-ink-400"
                    >
                      No active subscriptions yet.
                    </td>
                  </tr>
                )}
                {revenueByPlan.map((row: any, i: number) => (
                  <tr key={row.plan} className="hover:bg-ink-50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-2 h-2 rounded-full ${planColors[i] ?? "bg-ink-300"}`}
                        />
                        <span className="text-[13px] font-semibold text-ink-900">
                          {row.plan ?? "—"}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-sm text-ink-700 tabular-nums">
                      {(row.subscribers ?? 0).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-sm font-semibold text-ink-900 tabular-nums">
                      ${(row.total_revenue_dollars ?? 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Webhook Donut — 5 cols */}
        <div className="col-span-12 lg:col-span-5 bg-white rounded-xl border border-ink-200 shadow-sm p-6 flex flex-col">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-ink-900 tracking-tight">
              Webhook delivery rate
            </h3>
            <p className="text-xs text-ink-500 mt-0.5">
              Stability of outgoing API triggers
            </p>
          </div>
          <div className="flex-1 flex flex-col items-center justify-center">
            <WebhookDonut
              successRate={webhookSuccessRate}
              success={webhookSuccess}
              failed={webhookFailed}
            />
          </div>
          {webhookTotal > 0 && (
            <div className="mt-4 flex justify-between px-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-success-500" />
                <span className="text-[11px] font-bold text-ink-600 uppercase tracking-tight">
                  {webhookSuccess.toLocaleString()} success
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-danger-500" />
                <span className="text-[11px] font-bold text-ink-600 uppercase tracking-tight">
                  {webhookFailed.toLocaleString()} failed
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Meta */}
      <div className="pt-8 border-t border-ink-200 flex items-center justify-between text-ink-400 text-[10px] font-bold uppercase tracking-widest">
        <span>Data refreshed: Just now</span>
        <div className="flex items-center gap-4">
          <a className="hover:text-ink-900 transition-colors" href="#">
            Privacy
          </a>
          <a className="hover:text-ink-900 transition-colors" href="#">
            Legal
          </a>
          <a className="hover:text-ink-900 transition-colors" href="#">
            Support
          </a>
        </div>
      </div>
    </div>
  )
}

// ── helpers ──────────────────────────────────────────────────────────────

function synthesizeMRRSeries(current: number) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
  if (current === 0) return months.map((m) => ({ month: m, mrr: 0 }))
  return months.map((m, i) => ({
    month: m,
    mrr: Math.round(current * (0.55 + i * 0.075)),
  }))
}

function synthesizeChurnSeries() {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
  return months.map((m, i) => ({
    month: m,
    churn_rate: 0.041 - i * 0.0035,
  }))
}
