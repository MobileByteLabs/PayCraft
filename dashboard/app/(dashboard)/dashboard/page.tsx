export const runtime = "edge"

import Link from "next/link"
import { Activity, LayoutGrid, Webhook, UserPlus, PlusCircle, Sparkles } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant, getUserApps } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardHeader, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ButtonLink } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { AppsMatrix, type AppMatrixRow } from "@/components/dashboard/apps-matrix"
import { AppsComparisonChart } from "@/components/charts/apps-comparison-chart"
import { OverviewMetrics, type OverviewPoint } from "@/components/dashboard/overview-metrics"

/**
 * Account overview — a RevenueCat-style landing across EVERY app the signed-in
 * account owns. Current metrics come from the point-in-time tenant_* views; the
 * time-series is computed from REAL `subscriptions` rows (created_at / trial_* /
 * status), never synthesized. All queries are un-filtered by tenant_id — migration
 * 082's security_invoker + tenant-admin RLS returns exactly the owned rows.
 */
const DAY_MS = 86_400_000
const DEAD = new Set(["canceled", "expired", "incomplete_expired", "unpaid"])

export default async function OverviewPage() {
  const { tenant } = await requireTenant() // redirects to /onboarding when the account has no apps
  const supabase = createClient()
  const apps = await getUserApps()

  const [mrrRes, subsRes, webhookRes, productsRes, providersRes, auditRes, subRowsRes] = await Promise.all([
    supabase.from("tenant_mrr_view").select("tenant_id, mrr_dollars"),
    supabase.from("tenant_subscriber_count_view").select("tenant_id, active_count, trial_count, canceled_count"),
    supabase.from("tenant_webhook_delivery_view").select("tenant_id, total, success, success_rate"),
    supabase.from("tenant_products").select("tenant_id").eq("active", true),
    // `provider` and `is_active` come along now, not just tenant_id. The old select could only
    // answer "how many providers does this app have"; the account view needs the INVERSE — for
    // each provider, how many apps use it — because that count is what teaches the data model.
    // provider_accounts keys on owner_user_id, so a connection is made once and shared, and a
    // dashboard that never shows the sharing leaves the reader to infer it.
    supabase.from("tenant_providers").select("tenant_id, provider, is_active"),
    supabase.from("tenant_audit_log").select("id, tenant_id, action, actor_type, ts").order("ts", { ascending: false }).limit(8),
    supabase.from("subscriptions").select("created_at, updated_at, trial_start, trial_end, status, email"),
  ])

  const mrrById = new Map<string, number>()
  for (const r of mrrRes.data ?? []) mrrById.set(r.tenant_id, Number(r.mrr_dollars ?? 0))
  const subsById = new Map<string, { active: number; trial: number; canceled: number }>()
  for (const r of subsRes.data ?? [])
    subsById.set(r.tenant_id, { active: r.active_count ?? 0, trial: r.trial_count ?? 0, canceled: r.canceled_count ?? 0 })
  const whById = new Map<string, { total: number; success: number; rate: number }>()
  for (const r of webhookRes.data ?? [])
    whById.set(r.tenant_id, { total: r.total ?? 0, success: r.success ?? 0, rate: r.success_rate ?? 1 })
  const countBy = (rows: { tenant_id: string }[] | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1)
    return m
  }
  const productsById = countBy(productsRes.data)
  const providersById = countBy(providersRes.data)
  const appName = new Map(apps.map((a) => [a.id, a.name]))

  // ── Account-level provider roll-up ─────────────────────────────────────────
  // One row per provider, carrying how many of the account's apps use it. Counted over DISTINCT
  // tenant_ids: a provider row per app is the join table, so a naive length would double-count an
  // app that has both a test and a live connection.
  const PROVIDER_LABELS: Record<string, string> = {
    stripe: "Stripe",
    razorpay: "Razorpay",
    cashfree: "Cashfree",
    google_play: "Google Play",
    app_store: "App Store",
    upi: "UPI",
  }
  const providerApps = new Map<string, Set<string>>()
  const providerActive = new Map<string, boolean>()
  for (const r of (providersRes.data ?? []) as { tenant_id: string; provider: string; is_active: boolean }[]) {
    if (!providerApps.has(r.provider)) providerApps.set(r.provider, new Set())
    providerApps.get(r.provider)!.add(r.tenant_id)
    // A provider counts as active for the account if ANY app's connection is active.
    providerActive.set(r.provider, (providerActive.get(r.provider) ?? false) || !!r.is_active)
  }
  const accountProviders = [...providerApps.entries()]
    .map(([provider, tenants]) => ({
      provider,
      label: PROVIDER_LABELS[provider] ?? provider,
      appsUsing: tenants.size,
      active: providerActive.get(provider) ?? false,
      // Neither store exposes an API to enable sandbox, so their test state is a MANUAL step for
      // a human with a device. That renders neutral, never amber: it is an incomplete step rather
      // than a fault, and colouring it as a warning would make the board cry wolf permanently.
      storeManualTest: provider === "google_play" || provider === "app_store",
    }))
    .sort((a, b) => b.appsUsing - a.appsUsing || a.label.localeCompare(b.label))

  const rows: AppMatrixRow[] = apps.map((a) => {
    const s = subsById.get(a.id)
    const wh = whById.get(a.id)
    return {
      id: a.id,
      name: a.name,
      plan: a.plan,
      mrr: mrrById.get(a.id) ?? 0,
      active: s?.active ?? 0,
      trials: s?.trial ?? 0,
      canceled: s?.canceled ?? 0,
      products: productsById.get(a.id) ?? 0,
      providers: providersById.get(a.id) ?? 0,
      webhookRate: wh?.rate ?? 1,
      webhookTotal: wh?.total ?? 0,
    }
  })

  const totalMrr = rows.reduce((n, r) => n + r.mrr, 0)
  const totalActive = rows.reduce((n, r) => n + r.active, 0)
  const whTotals = rows.reduce((acc, r) => ({ total: acc.total + r.webhookTotal, success: acc.success + Math.round(r.webhookRate * r.webhookTotal) }), { total: 0, success: 0 })
  const acctWebhookRate = whTotals.total > 0 ? whTotals.success / whTotals.total : null
  const liveApps = rows.filter((r) => r.products > 0 && r.providers > 0).length
  const chartData = rows.map((r) => ({ name: r.name, mrr: r.mrr, active: r.active }))

  // ── Real daily time-series from subscriptions (last 365 days) ──────────────
  const arpu = totalActive > 0 ? totalMrr / totalActive : 0
  const parsed = (subRowsRes.data ?? []).map((s: any) => ({
    created: Date.parse(s.created_at),
    updated: s.updated_at ? Date.parse(s.updated_at) : null,
    tstart: s.trial_start ? Date.parse(s.trial_start) : null,
    tend: s.trial_end ? Date.parse(s.trial_end) : null,
    status: s.status as string,
  }))
  const distinctCustomers = new Set((subRowsRes.data ?? []).map((s: any) => s.email).filter(Boolean)).size

  const base = new Date()
  base.setUTCHours(23, 59, 59, 999)
  const baseMs = base.getTime()
  const DAYS = 365
  const series: OverviewPoint[] = []
  for (let i = DAYS - 1; i >= 0; i--) {
    const dayEnd = baseMs - i * DAY_MS
    const dayStart = dayEnd - DAY_MS + 1
    let active = 0
    let trials = 0
    let newSubs = 0
    for (const p of parsed) {
      if (p.created <= dayEnd && !(DEAD.has(p.status) && p.updated !== null && p.updated <= dayEnd)) active++
      if (p.tstart !== null && p.tstart <= dayEnd && (p.tend === null || p.tend >= dayStart)) trials++
      if (p.created > dayStart && p.created <= dayEnd) newSubs++
    }
    series.push({
      date: new Date(dayEnd).toISOString().slice(0, 10),
      active,
      trials,
      newSubs,
      revenue: Math.round(active * arpu),
    })
  }

  return (
    <div>
      <PageHeader
        title="Overview"
        subtitle={
          <>
            <span className="tabular-nums font-medium text-ink-700">{apps.length}</span>{" "}
            {apps.length === 1 ? "app" : "apps"} ·{" "}
            <span className="tabular-nums font-medium text-ink-700">{distinctCustomers.toLocaleString()}</span> customers under{" "}
            <span className="font-medium text-ink-700">{tenant.owner_email}</span>
          </>
        }
        actions={
          <>
            <ButtonLink href="/apps/new" variant="secondary" size="sm" leading={<PlusCircle className="w-4 h-4" />}>
              New app
            </ButtonLink>
            <ButtonLink href="/analytics" variant="primary" size="sm" leading={<Sparkles className="w-4 h-4" />}>
              Deep analytics
            </ButtonLink>
          </>
        }
      />

      {/* ── Account metrics: FOUR EQUAL PEERS ────────────────────────────────
          No gradient hero card. On a multi-app billing account no single number
          is the story, so nothing dominates. Flat surfaces separated by a
          hairline; the only card that carries semantic colour is one in a real
          problem state, which is what makes it findable at a glance.
          Per idea-layer/design-system/DESIGN.md. */}
      <section className="mb-10">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 lg:grid-cols-4">
          {[
            {
              label: "Active subscribers",
              value: totalActive.toLocaleString(),
              note: `${distinctCustomers.toLocaleString()} customers`,
              bad: false,
            },
            {
              label: "MRR",
              value: `$${Math.round(totalMrr).toLocaleString()}`,
              note: totalActive > 0 ? `$${arpu.toFixed(2)} ARPU` : "no active subscriptions",
              bad: false,
            },
            {
              label: "Apps",
              value: String(apps.length),
              note: `${liveApps} live · ${apps.length - liveApps} in setup`,
              bad: false,
            },
            {
              label: "Webhook delivery",
              value: acctWebhookRate === null ? "—" : `${(acctWebhookRate * 100).toFixed(1)}%`,
              note:
                acctWebhookRate === null
                  ? "no deliveries yet"
                  : acctWebhookRate < 0.99
                    ? "needs attention"
                    : "healthy",
              // Semantic red is spent here and nowhere else on the row. A healthy account shows
              // four neutral tiles, so a red one is unambiguous.
              bad: acctWebhookRate !== null && acctWebhookRate < 0.99,
            },
          ].map((m) => (
            <div key={m.label} className="bg-white px-5 py-5">
              <div className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                {m.label}
              </div>
              <div
                className={`mt-2 text-2xl font-semibold tabular-nums tracking-tight ${
                  m.bad ? "text-danger-600" : "text-ink-950"
                }`}
              >
                {m.value}
              </div>
              <div className={`mt-1 text-xs ${m.bad ? "text-danger-600" : "text-ink-500"}`}>
                {m.note}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Providers: the section that teaches the model ────────────────────
          Connected ONCE at account level and shared. The "Apps using" column is
          the proof, and it is the reason this section exists at all. */}
      {accountProviders.length > 0 && (
        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <div>
              <h2 className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                Providers
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Connected once, at account level. Apps share these connections.
              </p>
            </div>
            <Link
              href="/settings/provider-accounts"
              className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
            >
              Manage connections →
            </Link>
          </div>
          <div className="overflow-x-auto rounded-xl border border-ink-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 bg-ink-50">
                  {["Provider", "Scope", "Status", "Apps using"].map((h, i) => (
                    <th
                      key={h}
                      className={`px-5 py-2.5 font-mono text-2xs font-semibold uppercase tracking-[0.07em] text-ink-500 ${
                        i === 3 ? "text-right" : "text-left"
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accountProviders.map((p) => (
                  <tr key={p.provider} className="border-b border-ink-200 last:border-0">
                    <td className="px-5 py-3.5 font-medium text-ink-900">{p.label}</td>
                    <td className="px-5 py-3.5">
                      <span className="rounded-full border border-ink-200 px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-ink-500">
                        Account
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            p.active ? "bg-success-500" : "bg-ink-300"
                          }`}
                        />
                        <span className="text-ink-700">{p.active ? "Connected" : "Inactive"}</span>
                        {p.storeManualTest && (
                          <span
                            className="ml-1.5 text-ink-500"
                            title="Neither store exposes an API to enable sandbox testing. Test mode turns ready when a real sandbox purchase arrives."
                          >
                            · test: manual step
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-ink-700">
                      {p.appsUsing}
                      <span className="text-ink-400">
                        {" "}
                        / {apps.length}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* The real 365-day time series stays. It is computed from actual subscriptions rows, never
          synthesized, and it answers a question the four peer cards cannot: which direction. */}
      <section className="mb-10">
        <OverviewMetrics series={series} />
      </section>

      {/* Your apps */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-ink-500 uppercase tracking-wider">Your apps</h2>
            <Badge tone={liveApps === apps.length && apps.length > 0 ? "success" : "neutral"}>
              {liveApps}/{apps.length} live
            </Badge>
            {acctWebhookRate !== null && (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
                <Webhook className="w-3.5 h-3.5" /> {(acctWebhookRate * 100).toFixed(1)}% webhooks
              </span>
            )}
          </div>
          <Link href="/apps" className="text-xs font-bold text-brand-600 hover:underline">
            Manage apps →
          </Link>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon={<LayoutGrid className="w-5 h-5" />}
            title="No apps yet"
            description="Register your first app to start tracking billing across platforms."
            action={<ButtonLink href="/apps/new" variant="primary" size="sm">Register an app</ButtonLink>}
          />
        ) : (
          <AppsMatrix rows={rows} />
        )}
      </section>

      {/* Breakdown + activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-5">
          <Card>
            <CardHeader title="MRR by app" subtitle="Where your revenue comes from" />
            <CardBody>
              <AppsComparisonChart data={chartData} metric="mrr" />
            </CardBody>
          </Card>
        </div>
        <div className="lg:col-span-7">
          <Card>
            <CardHeader
              title="Recent activity"
              subtitle="Across all your apps"
              action={<Link href="/audit" className="text-xs font-bold text-brand-600 hover:underline">Audit log →</Link>}
            />
            {(auditRes.data ?? []).length === 0 ? (
              <CardBody>
                <div className="py-6 text-center">
                  <Activity className="w-5 h-5 text-ink-300 mx-auto mb-2" />
                  <p className="text-sm text-ink-500">No activity yet — changes across your apps will show up here.</p>
                </div>
              </CardBody>
            ) : (
              <div className="divide-y divide-ink-100">
                {(auditRes.data ?? []).map((row: any) => (
                  <div key={row.id} className="px-5 py-3 flex items-center justify-between hover:bg-ink-50/70 transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={
                          "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 " +
                          (row.actor_type === "user" ? "bg-info-50 text-info-600" : row.actor_type === "webhook" ? "bg-ink-100 text-ink-600" : "bg-brand-50 text-brand-600")
                        }
                      >
                        {row.actor_type === "user" ? <UserPlus className="w-4 h-4" /> : row.actor_type === "webhook" ? <Webhook className="w-4 h-4" /> : <Activity className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink-900 truncate">{row.action}</p>
                        <p className="text-xs text-ink-500 font-medium truncate">
                          {appName.get(row.tenant_id) ?? "—"} · <span className="capitalize">{row.actor_type}</span>
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-ink-400 font-medium flex-shrink-0 ml-3">{relativeTime(row.ts)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return "now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
