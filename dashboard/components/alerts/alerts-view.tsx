"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { clsx } from "clsx"
import { Settings2, Sparkles } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { SupabaseClient } from "@supabase/supabase-js"
import { useDashboard } from "@/components/app-providers"
import { LoadError, LoadingCard } from "@/components/query-ui"
import { ALERT_FILTERS, fetchAlerts, fetchInsights, unreadCounts, type AlertFilter } from "@/lib/alerts"
import { InboxList } from "@/components/alerts/inbox-list"

const FILTER_LABEL: Record<AlertFilter, string> = { all: "All", unread: "Unread", critical: "Critical", digest: "Digest" }

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })

/**
 * Alerts inbox (paycraft-attempt-observability GOAL D8 / AC-16): every owner alert PayCraft raised for the active
 * app — critical incidents the moment they fire, hourly digests, channel tests — with what each channel did with
 * it. Weekly AI insights (kind ai_insight) have their own section below. Read in the browser (RLS-scoped).
 */
export function AlertsView() {
  const { tenantId, supabase } = useDashboard()
  const sb = supabase as unknown as SupabaseClient
  const queryClient = useQueryClient()
  const requested = useSearchParams().get("filter") ?? ""
  const filter = (ALERT_FILTERS as readonly string[]).includes(requested) ? (requested as AlertFilter) : "all"

  const alertsQuery = useQuery({
    queryKey: ["alerts", tenantId, "list", filter],
    queryFn: () => fetchAlerts(sb, tenantId, filter),
  })
  const insightsQuery = useQuery({
    queryKey: ["alerts", tenantId, "insights"],
    queryFn: () => fetchInsights(sb, tenantId),
  })
  const countsQuery = useQuery({
    queryKey: ["alerts", tenantId, "counts"],
    queryFn: () => unreadCounts(sb, tenantId).catch(() => ({ total: 0, critical: 0 })),
  })
  const counts = countsQuery.data ?? { total: 0, critical: 0 }

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
        {alertsQuery.isPending ? (
          <LoadingCard label="Loading alerts…" />
        ) : alertsQuery.isError ? (
          <LoadError what="alerts" error={alertsQuery.error} retry={() => alertsQuery.refetch()} />
        ) : (
          <InboxList
            alerts={alertsQuery.data}
            filtered={filter !== "all"}
            onChanged={() => queryClient.invalidateQueries({ queryKey: ["alerts", tenantId] })}
          />
        )}
      </section>

      <section className="space-y-4" aria-labelledby="insights-h">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand-600" strokeWidth={2} />
          <h2 id="insights-h" className="text-lg font-bold tracking-tight text-ink-900">Weekly insights</h2>
        </div>
        {insightsQuery.isPending ? (
          <LoadingCard label="Loading insights…" rows={2} />
        ) : insightsQuery.isError ? (
          <LoadError what="insights" error={insightsQuery.error} retry={() => insightsQuery.refetch()} />
        ) : insightsQuery.data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-8 text-center">
            <p className="text-sm font-semibold text-ink-700">No weekly insight yet.</p>
            <p className="mt-1 text-xs text-ink-500">
              Once a week PayCraft reads your attempts and failures and writes up what changed and what to fix first. It lands here.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {insightsQuery.data.map((i) => (
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
