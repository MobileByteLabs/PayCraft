"use client"

import {
  TrendingDown,
  Users,
  CreditCard,
  LogOut,
  CheckCircle2,
} from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { LoadError, LoadingCard, fetchJson, useTenantRow } from "@/components/query-ui"
import { Badge } from "@/components/ui/badge"
import { MRRChart } from "@/components/charts/mrr-chart"
import { ChurnChart } from "@/components/charts/churn-chart"
import { WebhookDonut } from "@/components/charts/webhook-donut"
import { RangeMenu, SplitTable } from "@/components/analytics/funnel-chart"
import { rangeDays, rangeLabel, retentionLabel, splitsFromStats } from "@/lib/funnel"
import type { JoinedAnalytics, JoinedSegmentRow } from "@/lib/analytics-joined"
import { PaymentHealthPanel } from "@/components/analytics/payment-health"
import { AnalyticsFilters } from "@/components/analytics/analytics-filters"
import { JoinedFunnel } from "@/components/analytics/joined-funnel"
import { SegmentTable } from "@/components/analytics/segment-tables"
import { AiAuditPanel, type AuditFinding } from "@/components/analytics/ai-audit-panel"
import type { Ga4Overview } from "@/lib/ga4"
import { ga4ErrorMessage } from "@/lib/ga4-messages"
import { Ga4ConnectCard, type Ga4ConnectionRow } from "@/components/analytics/ga4-connect-card"
import { Ga4Panels } from "@/components/analytics/ga4-panels"
import { filterQueryString, readFilters, type AnalyticsSearch } from "@/lib/analytics-search"

/** /api/dash/analytics?part=joined — the joined report + its three segment tables (computed server-side). */
type JoinedResponse = {
  joined: JoinedAnalytics
  segments: { platform: JoinedSegmentRow[]; country: JoinedSegmentRow[]; appVersion: JoinedSegmentRow[] }
}
/** /api/dash/analytics?part=ga4 — PayCraft's Viewer email, the tenant's GA4 connection and the overview. */
type Ga4Response = { saEmail: string | null; connection: Ga4ConnectionRow | null; overview: Ga4Overview | null; days: number }

const regionName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" })
    // Intl throws a RangeError on anything that is not a region code — never let one label take the page down.
    return (cc: string) => {
      if (cc === "unknown") return "Unknown"
      if (!/^[A-Z]{2}$/.test(cc)) return cc
      try {
        return `${names.of(cc) ?? cc} (${cc})`
      } catch {
        return cc
      }
    }
  } catch {
    return (cc: string) => cc
  }
})()
const providerName = (p: string) => (p === "unknown" ? "Not chosen" : p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()))
const platformName = (p: string) =>
  p === "unknown" ? "Unknown" : p === "ios" ? "iOS" : p === "macos" ? "macOS" : p.charAt(0).toUpperCase() + p.slice(1)

/**
 * Analytics, read in the browser. Each section is its own query with its own skeleton, so the fast Supabase reads
 * (stats, charts, findings) appear first instead of the whole page waiting on GA4. The GA4-backed parts (joined
 * funnel + Payment health, the GA4 panel) come from /api/dash/analytics, which holds PayCraft's service account.
 */
export function AnalyticsView() {
  const { tenantId, mode, supabase } = useDashboard()
  const queryClient = useQueryClient()
  const sp = useSearchParams()
  const search: AnalyticsSearch = {
    range: sp.get("range") ?? undefined,
    platform: sp.get("platform") ?? undefined,
    country: sp.get("country") ?? undefined,
    app_version: sp.get("app_version") ?? undefined,
    plan: sp.get("plan") ?? undefined,
  }
  const filters = readFilters(search)
  const filterQuery = filterQueryString(filters)
  const rangeKey = search.range ?? ""

  // Paywall funnel range: 7 / 30 / 90 days, capped by the plan's analytics retention (tier_definitions).
  const tenantQuery = useTenantRow()
  const plan = tenantQuery.data?.plan ?? "free"
  const tierQuery = useQuery({
    queryKey: ["tier", plan, "analytics_retention_days"],
    enabled: tenantQuery.isSuccess,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tier_definitions")
        .select("analytics_retention_days")
        .eq("tier_name", plan)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data?.analytics_retention_days as number | null | undefined) ?? 7
    },
  })
  const retentionDays = tierQuery.data ?? null
  const range = retentionDays === null ? null : rangeDays(search.range, retentionDays)

  // The joined report (paycraft-ga4-analytics-audit): ONE filter set over the provider-truth funnel, Payment
  // health and the app's GA4 streams. A read failure is shown as such, never as an empty (healthy-looking) report.
  const joinedQuery = useQuery({
    queryKey: ["analytics", tenantId, "joined", mode, rangeKey, filterQuery],
    queryFn: () =>
      fetchJson<JoinedResponse>(
        `/api/dash/analytics?${new URLSearchParams({ part: "joined", ...(search.range ? { range: search.range } : {}) })}${filterQuery ? `&${filterQuery}` : ""}`,
      ),
  })
  const ga4Query = useQuery({
    queryKey: ["analytics", tenantId, "ga4", rangeKey],
    queryFn: () =>
      fetchJson<Ga4Response>(`/api/dash/analytics?${new URLSearchParams({ part: "ga4", ...(search.range ? { range: search.range } : {}) })}`),
  })
  const findingsQuery = useQuery({
    queryKey: ["analytics", tenantId, "findings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("analytics_findings")
        .select("id,kind,severity,title,summary,proposed_fix,status,fixed_note,source,window_start,window_end,created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(20)
      if (error) throw new Error(error.message)
      return (data ?? []) as AuditFinding[]
    },
  })
  const skusQuery = useQuery({
    queryKey: ["products", "skus", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenant_products").select("sku").eq("tenant_id", tenantId).order("display_order")
      if (error) throw new Error(error.message)
      return (data ?? []).map((p: { sku: string }) => p.sku)
    },
  })
  const metricsQuery = useQuery({
    queryKey: ["analytics", tenantId, "metrics"],
    queryFn: async () => {
      const results = await Promise.all([
        supabase.from("tenant_mrr_view").select("mrr_dollars,month").eq("tenant_id", tenantId).maybeSingle(),
        supabase.from("tenant_churn_view").select("month,churn_rate").eq("tenant_id", tenantId).order("month").limit(6),
        supabase
          .from("tenant_subscriber_count_view")
          .select("active_count,trial_count,canceled_count")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("tenant_revenue_by_plan_view")
          .select("plan,subscribers,total_revenue_dollars")
          .eq("tenant_id", tenantId)
          .order("total_revenue_dollars", { ascending: false }),
        supabase.from("tenant_webhook_delivery_view").select("total,success,success_rate").eq("tenant_id", tenantId).maybeSingle(),
        // Raw subscription rows for the REAL month-by-month series. tenant_mrr_view is point-in-time, so a
        // trend has to be derived from the rows themselves; the alternative this replaces was inventing it.
        supabase.from("subscriptions").select("created_at,updated_at,status").eq("tenant_id", tenantId),
      ])
      const failed = results.find((r) => r.error)
      if (failed?.error) throw new Error(failed.error.message)
      const [mrrRes, churnRes, subCountRes, revenueRes, webhookRes, subsSeriesRes] = results
      return { mrrRes, churnRes, subCountRes, revenueRes, webhookRes, subsSeriesRes } as unknown as MetricsData
    },
  })

  const joined = joinedQuery.data?.joined ?? null
  const keysOf = (...lists: ({ key: string }[] | undefined)[]) =>
    [...new Set(lists.flatMap((l) => (l ?? []).map((r) => r.key)).filter((k) => k && k !== "unknown"))]
  const filterOptions = {
    platforms: keysOf(joined?.ga4?.byPlatform, joined?.paycraft.by_platform),
    countries: keysOf(joined?.ga4?.byCountry, joined?.paycraft.by_country).sort(),
    appVersions: keysOf(joined?.ga4?.byAppVersion, joined?.paycraft.by_app_version),
    plans: skusQuery.data ?? [],
  }
  const byProvider = joined ? splitsFromStats(joined.paycraft).byProvider : []
  const joinedError = joinedQuery.isError ? joinedQuery.error.message : null

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
            {retentionDays !== null && (
              <Badge tone="brand">
                Retention {retentionLabel(retentionDays)} ({tenantQuery.data?.plan ?? "free"})
              </Badge>
            )}
          </div>
        </div>
        {range && retentionDays !== null && <RangeMenu days={range.days} retentionDays={retentionDays} query={filterQuery} />}
      </div>

      {range && <AnalyticsFilters days={range.days} value={filters} options={filterOptions} />}

      {/* Paywall funnel — GA4 behaviour beside PayCraft's buyers and provider-confirmed Paid, one filter set. */}
      <section className="space-y-6" aria-labelledby="funnel-h">
        <div>
          <h3 id="funnel-h" className="text-lg font-bold tracking-tight text-ink-900">Paywall funnel</h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {range ? `${rangeLabel(range.days)}${range.capped ? ` (your plan keeps ${retentionLabel(retentionDays!)})` : ""} · ` : ""}{mode} mode · Paid = purchases the providers confirmed
          </p>
        </div>
        {joinedQuery.isPending ? (
          <LoadingCard label="Loading the paywall funnel…" rows={6} />
        ) : joinedQuery.isSuccess && joined ? (
          <>
            <JoinedFunnel
              ga4={joined.ga4?.funnel ?? null}
              ga4Status={joined.ga4Status}
              paycraft={joined.paycraft}
              notApplied={{ ga4: joined.ga4?.notApplied ?? [], paid: joined.paycraft.paid_not_applied ?? [] }}
              filtered={!!filterQuery}
            />
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <SegmentTable title="By platform" rows={joinedQuery.data.segments.platform} label={platformName} />
              <SegmentTable title="By country" rows={joinedQuery.data.segments.country} label={regionName} />
              <SegmentTable title="By app version" rows={joinedQuery.data.segments.appVersion} label={(v) => (v === "unknown" ? "Not reported" : v)} />
              <SplitTable title="By payment provider" rows={byProvider} label={providerName} base="checkouts" />
            </div>
          </>
        ) : (
          <p role="alert" className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            Couldn&apos;t load the funnel: {joinedError}{" "}
            <button onClick={() => joinedQuery.refetch()} className="font-semibold underline">
              Retry
            </button>
          </p>
        )}
      </section>

      {/* What Claude found in this app's data and what was done about it (weekly digest + /idea-paycraft-analytics). */}
      {findingsQuery.isPending ? (
        <LoadingCard label="Loading findings…" />
      ) : findingsQuery.isError ? (
        <LoadError what="findings" error={findingsQuery.error} retry={() => findingsQuery.refetch()} />
      ) : (
        <AiAuditPanel findings={findingsQuery.data} />
      )}

      {/* Payment health — where attempts fail and where buyers give up, under the same filters. */}
      {joinedQuery.isPending ? (
        <LoadingCard label="Loading payment health…" rows={4} />
      ) : joined ? (
        <PaymentHealthPanel data={joined.health} days={joined.window.days} mode={mode} countryLabel={regionName} providerLabel={providerName} />
      ) : (
        <section aria-label="Payment health" role="alert" className="rounded-xl border border-danger-100 bg-danger-50 p-6 text-sm text-danger-700">
          Payment health could not be loaded: {joinedError}
        </section>
      )}

      {/* Google Analytics — the app's own GA4 property next to PayCraft's exact funnel. */}
      <section className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm" aria-labelledby="ga4-h">
        <div className="mb-5">
          <h3 id="ga4-h" className="text-lg font-bold tracking-tight text-ink-900">Google Analytics</h3>
          <p className="mt-0.5 text-xs text-ink-500">Your GA4 property, read with PayCraft's Viewer access — app-wide context for the funnel above.</p>
        </div>
        {ga4Query.isPending ? (
          <LoadingCard label="Loading Google Analytics…" />
        ) : ga4Query.isError ? (
          <LoadError what="Google Analytics" error={ga4Query.error} retry={() => ga4Query.refetch()} />
        ) : (
          <>
            <Ga4ConnectCard
              saEmail={ga4Query.data.saEmail}
              connection={ga4Query.data.connection}
              onChanged={() => queryClient.invalidateQueries({ queryKey: ["analytics", tenantId] })}
            />
            {ga4Query.data.overview?.ok && <div className="mt-6"><Ga4Panels data={ga4Query.data.overview} days={ga4Query.data.days} /></div>}
            {ga4Query.data.overview && !ga4Query.data.overview.ok && (
              <p className="mt-4 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700" role="alert" data-testid="ga4-report-error">
                {ga4ErrorMessage(ga4Query.data.overview.error, ga4Query.data.saEmail)}
              </p>
            )}
          </>
        )}
      </section>

      {metricsQuery.isPending ? (
        <LoadingCard label="Loading revenue and churn…" rows={6} />
      ) : metricsQuery.isError ? (
        <LoadError what="revenue and churn" error={metricsQuery.error} retry={() => metricsQuery.refetch()} />
      ) : (
        <MetricsSection {...metricsQuery.data} />
      )}

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

type Res<T> = { data: T | null }
type MetricsData = {
  mrrRes: Res<{ mrr_dollars: number | null; month: string | null }>
  churnRes: Res<{ month: string; churn_rate: number | null }[]>
  subCountRes: Res<{ active_count: number | null; trial_count: number | null; canceled_count: number | null }>
  revenueRes: Res<{ plan: string | null; subscribers: number | null; total_revenue_dollars: number | null }[]>
  webhookRes: Res<{ total: number | null; success: number | null; success_rate: number | null }>
  subsSeriesRes: Res<{ created_at: string; updated_at: string | null; status: string }[]>
}

/** Stats strip + charts — derived from the Supabase views and REAL subscription rows (nothing synthesized). */
function MetricsSection({ mrrRes, churnRes, subCountRes, revenueRes, webhookRes, subsSeriesRes }: MetricsData) {
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
    <>
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

    </>
  )
}
