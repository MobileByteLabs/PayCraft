"use client"

import { useQuery } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { usePlatformOwner, LoadingRows, LoadError } from "@/components/dashboard/account-queries"
import type { HealthCheck } from "@/lib/backend-health"

// Platform health for the PayCraft operator: live checks (supabase/functions/health, via the dashboard's own
// /api/health) and the incident history behind the alert emails (migration 185). Platform-owner only — RLS on
// health_incidents enforces the same rule the page does.

type Incident = {
  id: string
  check_name: string
  opened_at: string
  resolved_at: string | null
  first_detail: string | null
  last_detail: string | null
}

const fmt = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"

function duration(from: string, to: string | null): string {
  const mins = Math.max(1, Math.round(((to ? new Date(to) : new Date()).getTime() - new Date(from).getTime()) / 60000))
  return mins < 120 ? `${mins} min` : `${Math.round(mins / 60)} h`
}

export function AdminHealth() {
  const ownerQuery = usePlatformOwner()
  if (ownerQuery.isPending) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <LoadingRows label="Checking access…" rows={2} />
      </div>
    )
  }
  if (ownerQuery.isError) {
    return (
      <div className="max-w-4xl mx-auto py-8">
        <LoadError what="your access" error={ownerQuery.error} onRetry={() => void ownerQuery.refetch()} />
      </div>
    )
  }
  if (!ownerQuery.data) {
    return (
      <div className="max-w-2xl mx-auto pt-20 text-center">
        <h1 className="text-2xl font-bold text-ink-900">Platform health is admin-only</h1>
      </div>
    )
  }
  return <HealthBody />
}

function HealthBody() {
  const { supabase } = useDashboard()
  // /api/health runs the backend checks server-side (it is the public /health); only the backend ones show here.
  // It answers 503 with the same JSON body when degraded, so the body is read regardless of status.
  const checksQuery = useQuery({
    queryKey: ["admin-health", "checks"],
    // A full health run can take ~25 s: refresh on demand (Retry / reload), not on every tab focus or realtime nudge.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const res = await fetch("/api/health", { cache: "no-store" })
      const body = (await res.json().catch(() => null)) as { checks?: HealthCheck[] } | null
      if (!body?.checks) throw new Error(`health check answered ${res.status}`)
      return body.checks.filter((c) => c.name === "backend" || c.name.startsWith("backend:"))
    },
  })
  const incidentsQuery = useQuery({
    queryKey: ["admin-health", "incidents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("health_incidents")
        .select("*")
        .order("opened_at", { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []) as Incident[]
    },
  })
  const checks = checksQuery.data ?? []
  const rows = incidentsQuery.data ?? []
  const open = rows.filter((r) => !r.resolved_at)
  const allOk = checks.every((c) => c.ok)

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-ink-900">Platform health</h1>
        <p className="mt-1 text-sm text-ink-500">
          Polled every 15 minutes and on every visit to <code>/health</code>. A failing check opens an incident and
          emails the platform owner once; recovery emails again.
        </p>
      </div>

      {checksQuery.isPending ? (
        <section className="rounded-xl border border-ink-200 bg-white">
          <LoadingRows label="Running health checks…" rows={2} />
        </section>
      ) : checksQuery.isError ? (
        <section className="rounded-xl border border-ink-200 bg-white">
          <LoadError what="health checks" error={checksQuery.error} onRetry={() => void checksQuery.refetch()} />
        </section>
      ) : (
        <section className={`rounded-xl border p-5 ${allOk ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
          <p className={`font-semibold ${allOk ? "text-green-800" : "text-red-800"}`}>
            {allOk ? "All systems healthy" : `${checks.filter((c) => !c.ok).length} check(s) failing`}
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            {checks.map((c) => (
              <li key={c.name} className="flex gap-3">
                <span className={c.ok ? "text-green-700" : "text-red-700"}>{c.ok ? "●" : "▲"}</span>
                <span className="font-mono text-ink-900">{c.name.replace("backend:", "")}</span>
                <span className="text-ink-500">{c.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-ink-900">
          Incidents {open.length > 0 && <span className="text-red-700">· {open.length} open</span>}
        </h2>
        {incidentsQuery.isPending ? (
          <LoadingRows label="Loading incidents…" />
        ) : incidentsQuery.isError ? (
          <LoadError what="incidents" error={incidentsQuery.error} onRetry={() => void incidentsQuery.refetch()} />
        ) : rows.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">No incidents recorded.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-ink-500">
              <tr>
                <th className="py-2">Check</th>
                <th>Opened</th>
                <th>Duration</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-ink-100 align-top">
                  <td className="py-2 font-mono">{r.check_name}</td>
                  <td>{fmt(r.opened_at)}</td>
                  <td className={r.resolved_at ? "text-ink-700" : "text-red-700 font-semibold"}>
                    {r.resolved_at ? duration(r.opened_at, r.resolved_at) : `open · ${duration(r.opened_at, null)}`}
                  </td>
                  <td className="text-ink-500">{r.last_detail ?? r.first_detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
