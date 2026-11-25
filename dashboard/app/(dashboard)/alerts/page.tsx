export const runtime = "edge"

import Link from "next/link"
import { clsx } from "clsx"
import { Settings2, Sparkles } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ALERT_FILTERS, fetchAlerts, fetchInsights, unreadCounts, type AlertFilter } from "@/lib/alerts"
import { InboxList } from "@/components/alerts/inbox-list"

const FILTER_LABEL: Record<AlertFilter, string> = { all: "All", unread: "Unread", critical: "Critical", digest: "Digest" }

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

/**
 * Alerts inbox (paycraft-attempt-observability GOAL D8 / AC-16): every owner alert PayCraft raised for the active
 * app — critical incidents the moment they fire, hourly digests, channel tests — with what each channel did with
 * it. Weekly AI insights (kind ai_insight) have their own section below.
 */
export default async function AlertsPage({ searchParams }: { searchParams?: { filter?: string } }) {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const filter = (ALERT_FILTERS as readonly string[]).includes(searchParams?.filter ?? "") ? (searchParams!.filter as AlertFilter) : "all"

  const [alertsRes, insightsRes, counts] = await Promise.all([
    fetchAlerts(supabase, tenant.id, filter).then((d) => ({ d, e: null as string | null }), (e: Error) => ({ d: [], e: e.message })),
    fetchInsights(supabase, tenant.id).then((d) => ({ d, e: null as string | null }), (e: Error) => ({ d: [], e: e.message })),
    unreadCounts(supabase, tenant.id).catch(() => ({ total: 0, critical: 0 })),
  ])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Alerts</h1>
          <p className="mt-1 text-sm text-ink-500">
            Critical incidents are delivered immediately; abandons and declines arrive as an hourly digest.
          </p>
        </div>
        <Link
          href="/settings#alert-channels"
          className="inline-flex items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs font-semibold text-ink-700 hover:bg-ink-50"
        >
          <Settings2 className="h-3.5 w-3.5" strokeWidth={2} /> Delivery channels
        </Link>
      </div>

      <section className="space-y-4" aria-label="Alerts inbox">
        <nav className="inline-flex rounded-lg border border-ink-200 bg-white p-1 text-sm" aria-label="Filter alerts">
          {ALERT_FILTERS.map((f) => (
            <Link
              key={f}
              href={f === "all" ? "/alerts" : `/alerts?filter=${f}`}
              aria-current={filter === f ? "page" : undefined}
              className={clsx(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-colors",
                filter === f ? "bg-brand-50 text-brand-700" : "text-ink-500 hover:bg-ink-50 hover:text-ink-900",
              )}
            >
              {FILTER_LABEL[f]}
              {f === "unread" && counts.total > 0 && (
                <span className={clsx("rounded-full px-1.5 text-[10px] font-bold tabular-nums", counts.critical > 0 ? "bg-danger-100 text-danger-700" : "bg-ink-100 text-ink-700")}>
                  {counts.total}
                </span>
              )}
            </Link>
          ))}
        </nav>
        {alertsRes.e ? (
          <p role="alert" className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-700">Couldn't load alerts: {alertsRes.e}</p>
        ) : (
          <InboxList alerts={alertsRes.d} filtered={filter !== "all"} />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="insights-h">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" strokeWidth={2} />
          <h2 id="insights-h" className="text-lg font-bold tracking-tight text-ink-900">Weekly insights</h2>
        </div>
        {insightsRes.e ? (
          <p role="alert" className="rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-700">Couldn't load insights: {insightsRes.e}</p>
        ) : insightsRes.d.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-8 text-center">
            <p className="text-sm font-semibold text-ink-700">No weekly insight yet.</p>
            <p className="mt-1 text-xs text-ink-500">
              Once a week PayCraft reads your attempts and failures and writes up what changed and what to fix first. It lands here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {insightsRes.d.map((i) => (
              <li key={i.id} className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-bold text-ink-900">{i.title}</h3>
                  <span className="text-xs tabular-nums text-ink-500">{fmtDate(i.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-line text-sm text-ink-700">{i.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
