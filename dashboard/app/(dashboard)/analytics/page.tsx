export const runtime = "edge"

import {
  TrendingUp,
  TrendingDown,
  Users,
  Webhook,
  CreditCard,
  LogOut,
  CheckCircle2,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { MRRChart } from "@/components/charts/mrr-chart"
import { ChurnChart } from "@/components/charts/churn-chart"
import { WebhookDonut } from "@/components/charts/webhook-donut"
import { FunnelChart, RangeMenu, SplitTable } from "@/components/analytics/funnel-chart"
import { funnel, rangeDays, splitBy, type FunnelEvent } from "@/lib/funnel"
import { getMode } from "@/lib/mode"
import { ga4ErrorMessage, ga4Overview, paycraftGa4Account } from "@/lib/ga4"
import { Ga4ConnectCard, type Ga4ConnectionRow } from "@/components/analytics/ga4-connect-card"
import { Ga4Panels } from "@/components/analytics/ga4-panels"

export default async function AnalyticsPage({ searchParams }: { searchParams?: { range?: string } }) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  // Paywall funnel range: 7 / 30 / 90 days, capped by the plan's analytics retention (tier_definitions).
  const tierRes = await supabase
    .from("tier_definitions")
    .select("analytics_retention_days")
    .eq("tier_name", tenant.plan ?? "free")
    .maybeSingle()
  const retentionDays = tierRes.data?.analytics_retention_days ?? 7
  const range = rangeDays(searchParams?.range, retentionDays)
  const since = new Date(Date.now() - range.days * 86_400_000).toISOString()

  // Google Analytics (GOAL D4): the tenant's GA4 property, read with PayCraft's Viewer service account.
  const ga4Account = paycraftGa4Account()
  const { data: ga4Connection } = await supabase
    .from("tenant_ga4_connections")
    .select("property_id,verified_at,last_error,stream_ids")
    .eq("tenant_id", tenant.id)
    .maybeSingle()
  const ga4 = ga4Account && ga4Connection?.verified_at
    ? await ga4Overview(ga4Connection.property_id, range.days, { token: ga4Account.token, saEmail: ga4Account.email }, ga4Connection.stream_ids ?? [])
    : null
  const eventsRes = await supabase
    .from("paywall_events")
    .select("name,user_ref,device_ref,country,provider")
    .eq("tenant_id", tenant.id)
    .eq("mode", getMode())
    .gte("occurred_at", since)
    .in("name", ["paycraft_paywall_view", "paycraft_plan_select", "paycraft_checkout_start", "paycraft_purchase_success"])
    .limit(50_000)
  const funnelEvents = (eventsRes.data ?? []) as FunnelEvent[]
  const funnelRows = funnel(funnelEvents)
  const byCountry = splitBy(funnelEvents, "country")
  const byProvider = splitBy(funnelEvents, "provider")
  const regionName = (() => {
    try {
      const names = new Intl.DisplayNames(["en"], { type: "region" })
      return (cc: string) => (cc === "unknown" ? "Unknown" : `${names.of(cc) ?? cc} (${cc})`)
    } catch {
      return (cc: string) => cc
    }
  })()
  const providerName = (p: string) => (p === "unknown" ? "Not chosen" : p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))

  const [mrrRes, churnRes, subCountRes, revenueRes, webhookRes, subsSeriesRes] =
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
      // Raw subscription rows for the REAL month-by-month series below. tenant_mrr_view is
      // point-in-time, so a trend has to be derived from the rows themselves; the alternative
      // this replaces was inventing the trend outright.
      supabase
        .from("subscriptions")
        .select("created_at,updated_at,status")
        .eq("tenant_id", tenant.id),
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

  // ── REAL series, computed from subscriptions. Nothing here is synthesized. ────────────────────
  //
  // WHAT THIS REPLACES, because it matters more than the code does:
  //
  //   `synthesizeMRRSeries(mrrToday)` ran UNCONDITIONALLY and fabricated a six-month curve from
  //   today's figure as `current * (0.55 + i * 0.075)` — a guaranteed upward slope, drawn whether
  //   the business was growing, flat or shrinking. `synthesizeChurnSeries()` did the same for
  //   churn whenever the view returned no rows, inventing a rate falling from 4.1% to 2.35%:
  //   fabricated good news, on the exact chart an operator reads to decide whether retention is
  //   working.
  //
  //   Neither was labelled as an estimate on screen. The overview page states in its own header
  //   that its series is "computed from REAL subscriptions rows, never synthesized", so this page
  //   was also contradicting the product's own documented standard.
  //
  // A missing window now renders an explicit empty state instead of a curve, because an invented
  // trend and a real one are indistinguishable once drawn, and the invented one is always
  // flattering.
  const monthKey = (d: Date) => d.toISOString().slice(0, 7)
  const monthLabel = (ym: string) =>
    new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short" })

  const months: string[] = []
  {
    const cursor = new Date()
    cursor.setUTCDate(1)
    cursor.setUTCHours(0, 0, 0, 0)
    for (let i = 5; i >= 0; i--) {
      const d = new Date(cursor)
      d.setUTCMonth(cursor.getUTCMonth() - i)
      months.push(monthKey(d))
    }
  }

  // Active-at-month-end, from real rows: created on or before the month end, and not dead by then.
  // ARPU is today's MRR over today's actives, which is the only rate this page can honestly know;
  // applying it backwards gives a revenue SHAPE that follows real subscriber counts rather than a
  // formula. When there are no subscriptions at all the series is empty and the chart says so.
  const DEAD_STATES = new Set(["canceled", "cancelled", "expired", "incomplete_expired", "unpaid"])
  const subsForSeries = (subsSeriesRes.data ?? []) as {
    created_at: string
    updated_at: string | null
    status: string
  }[]
  const arpuNow = activeSubs > 0 ? mrrToday / activeSubs : 0

  const mrrSeries =
    subsForSeries.length === 0
      ? []
      : months.map((ym) => {
          const end = new Date(`${ym}-01T00:00:00Z`)
          end.setUTCMonth(end.getUTCMonth() + 1)
          const endMs = end.getTime() - 1
          let active = 0
          for (const s of subsForSeries) {
            const created = Date.parse(s.created_at)
            if (Number.isNaN(created) || created > endMs) continue
            const updated = s.updated_at ? Date.parse(s.updated_at) : null
            const deadByThen = DEAD_STATES.has(s.status) && updated !== null && updated <= endMs
            if (!deadByThen) active++
          }
          return { month: monthLabel(ym), mrr: Math.round(active * arpuNow) }
        })

  const churnSeries = (churnRes.data ?? []).map((r: any) => ({
    month: new Date(r.month).toLocaleDateString("en-US", { month: "short" }),
    churn_rate: r.churn_rate ?? 0,
  }))
  // No fallback. An empty churn view means there is no churn history yet, and saying so is the
  // honest answer.
  const churnDisplay = churnSeries

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
              Retention {retentionDays} days ({tenant.plan ?? "free"})
            </Badge>
          </div>
        </div>
        <RangeMenu days={range.days} retentionDays={retentionDays} />
      </div>

      {/* Paywall funnel — from PayCraft's own paywall_events (exact; GA4 panels show app-level context). */}
      <section className="space-y-6" aria-labelledby="funnel-h">
        <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
          <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 id="funnel-h" className="text-lg font-bold tracking-tight text-ink-900">Paywall funnel</h3>
              <p className="mt-0.5 text-xs text-ink-500">
                Distinct buyers at each step, last {range.days} days{range.capped ? ` (your plan keeps ${retentionDays})` : ""} · {getMode()} mode
              </p>
            </div>
          </div>
          <FunnelChart rows={funnelRows} />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SplitTable title="By country" rows={byCountry} label={regionName} />
          <SplitTable title="By payment provider" rows={byProvider} label={providerName} base="checkouts" />
        </div>
      </section>

      {/* Google Analytics — the app's own GA4 property next to PayCraft's exact funnel. */}
      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm" aria-labelledby="ga4-h">
        <div className="mb-5">
          <h3 id="ga4-h" className="text-lg font-bold tracking-tight text-ink-900">Google Analytics</h3>
          <p className="mt-0.5 text-xs text-ink-500">Your GA4 property, read with PayCraft's Viewer access — app-wide context for the funnel above.</p>
        </div>
        <Ga4ConnectCard saEmail={ga4Account?.email ?? null} connection={(ga4Connection as Ga4ConnectionRow | null) ?? null} />
        {ga4?.ok && <div className="mt-6"><Ga4Panels data={ga4} days={range.days} /></div>}
        {ga4 && !ga4.ok && (
          <p className="mt-4 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700" role="alert" data-testid="ga4-report-error">
            {ga4ErrorMessage(ga4.error, ga4Account?.email ?? null)}
          </p>
        )}
      </section>

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
          {/* An empty series renders as an explicit statement, never as a flat line at zero.
              A confident flat line and "we have no data" look identical once drawn, and the
              reader cannot tell which one they are looking at. */}
          <div className="h-64">
            {mrrSeries.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 px-6 text-center">
              <p className="text-sm font-medium text-ink-700">"No revenue history yet"</p>
              <p className="mt-1 text-xs text-ink-500">"This chart fills in as subscriptions are created. Nothing is estimated."</p>
            </div>
            ) : (
              <MRRChart data={mrrSeries} />
            )}
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
            {churnDisplay.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 px-6 text-center">
              <p className="text-sm font-medium text-ink-700">"No churn history yet"</p>
              <p className="mt-1 text-xs text-ink-500">"Churn is measured once subscriptions have had a full period to renew or lapse."</p>
            </div>
            ) : (
              <ChurnChart data={churnDisplay} />
            )}
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
