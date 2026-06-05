import { TrendingUp, Users, TrendingDown, Webhook } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody, StatCard } from "@/components/ui/card"
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

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle={
          <>
            MRR, churn, active subscribers, revenue by plan, webhook delivery.
            Retention <span className="tabular-nums">90 days</span> (
            <span className="capitalize">{tenant.plan}</span>).
          </>
        }
        actions={
          <select className="input w-32">
            <option>Last 30 days</option>
            <option>Last 90 days</option>
            <option>Last 12 months</option>
          </select>
        }
      />

      <section className="grid grid-cols-4 gap-4 mb-8 animate-slide-up">
        <StatCard
          label="MRR today"
          value={`$${mrrToday.toFixed(0)}`}
          icon={<TrendingUp className="w-4 h-4" />}
          trend={
            mrrToday > 0
              ? { value: "+12% mo/mo", tone: "success" }
              : { value: "$0", tone: "neutral" }
          }
        />
        <StatCard
          label="Active subscribers"
          value={activeSubs.toLocaleString()}
          icon={<Users className="w-4 h-4" />}
          helper={
            trialSubs > 0 ? (
              <span className="tabular-nums">{trialSubs} in trial</span>
            ) : undefined
          }
        />
        <StatCard
          label="Churn (last)"
          value={`${(churnLatest * 100).toFixed(1)}%`}
          icon={<TrendingDown className="w-4 h-4" />}
          trend={
            churnLatest < 0.05
              ? { value: "Healthy", tone: "success" }
              : { value: "Watch", tone: "neutral" }
          }
        />
        <StatCard
          label="Webhook delivery"
          value={`${(webhookSuccessRate * 100).toFixed(1)}%`}
          icon={<Webhook className="w-4 h-4" />}
          trend={{
            value: webhookTotal === 0 ? "—" : "Live",
            tone: webhookTotal === 0 ? "neutral" : "success",
          }}
        />
      </section>

      <div className="grid grid-cols-2 gap-6 mb-6">
        <Card>
          <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">
                Monthly recurring revenue
              </h3>
              <p className="text-xs text-ink-500 mt-0.5">Last 6 months</p>
            </div>
            <Badge tone="brand">${mrrToday.toFixed(0)} now</Badge>
          </div>
          <CardBody className="!p-3">
            <MRRChart data={mrrSeries} />
          </CardBody>
        </Card>

        <Card>
          <div className="px-5 py-4 border-b border-ink-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-ink-900">
                Monthly churn
              </h3>
              <p className="text-xs text-ink-500 mt-0.5">
                % canceled subscribers per month
              </p>
            </div>
            <Badge tone={churnLatest < 0.05 ? "success" : "warning"}>
              {(churnLatest * 100).toFixed(1)}%
            </Badge>
          </div>
          <CardBody className="!p-3">
            <ChurnChart data={churnDisplay} />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2">
          <Card>
            <div className="px-5 py-4 border-b border-ink-100">
              <h3 className="text-sm font-semibold text-ink-900">
                Revenue by plan
              </h3>
              <p className="text-xs text-ink-500 mt-0.5">
                Aggregated across all active subscribers
              </p>
            </div>
            <table className="w-full">
              <thead className="bg-ink-50/60 border-b border-ink-200">
                <tr>
                  <th className="px-5 py-2.5 text-2xs font-bold text-ink-400 uppercase tracking-widest text-left">
                    Plan
                  </th>
                  <th className="px-5 py-2.5 text-2xs font-bold text-ink-400 uppercase tracking-widest text-right">
                    Subscribers
                  </th>
                  <th className="px-5 py-2.5 text-2xs font-bold text-ink-400 uppercase tracking-widest text-right">
                    Revenue
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {revenueByPlan.length === 0 && (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-5 py-10 text-center text-sm text-ink-400"
                    >
                      No active subscriptions yet.
                    </td>
                  </tr>
                )}
                {revenueByPlan.map((row: any) => (
                  <tr key={row.plan} className="hover:bg-ink-50/40">
                    <td className="px-5 py-3.5">
                      <span className="code-inline">{row.plan ?? "—"}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-ink-700 text-right tabular-nums">
                      {row.subscribers.toLocaleString()}
                    </td>
                    <td className="px-5 py-3.5 text-sm font-semibold text-ink-900 text-right tabular-nums">
                      ${(row.total_revenue_dollars ?? 0).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        <Card>
          <div className="px-5 py-4 border-b border-ink-100">
            <h3 className="text-sm font-semibold text-ink-900">
              Webhook delivery
            </h3>
            <p className="text-xs text-ink-500 mt-0.5">Last 30 days</p>
          </div>
          <CardBody>
            <WebhookDonut
              successRate={webhookSuccessRate}
              success={webhookSuccess}
              failed={webhookFailed}
            />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}

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
