"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import { Activity } from "lucide-react"
import { useDashboard } from "@/components/app-providers"
import { LoadError, LoadingCard } from "@/components/query-ui"
import { EmptyState } from "@/components/ui/empty-state"
import {
  countersFromCompare,
  countersFromEvents,
  distinct,
  eventLabel,
  minuteSeries,
  pushEvent,
  versionTable,
  type LiveCounters,
  type LiveEvent,
  type LiveMinuteRow,
  type VersionCompareRow,
  type VersionRow,
} from "@/lib/live"

const HOUR = 60 * 60_000
const EVENT_COLUMNS = "id,name,reason,provider,app_version,country,platform,mode,occurred_at"

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`)
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })

/**
 * Live — the last hour of paywall traffic, the per-version comparison and the realtime event stream
 * (realtime-analytics spec, "Live page"). Counters + sparkline refetch every 60 s; the stream is Supabase Realtime.
 */
export function LiveView() {
  const { tenantId, mode, supabase } = useDashboard()
  const [version, setVersion] = useState<string | null>(null)
  const [country, setCountry] = useState<string | null>(null)

  const compareHourQuery = useQuery({
    queryKey: ["live", tenantId, mode, "compare-60m"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_version_compare", {
        p_tenant: tenantId,
        p_since: new Date(Date.now() - HOUR).toISOString(),
        p_mode: mode,
      })
      if (error) throw new Error(error.message)
      return (data ?? []) as VersionCompareRow[]
    },
  })
  const minutesQuery = useQuery({
    queryKey: ["live", tenantId, mode, "minutes-60m"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_live_minutes", {
        p_tenant: tenantId,
        p_since: new Date(Date.now() - HOUR).toISOString(),
        p_mode: mode,
      })
      if (error) throw new Error(error.message)
      return { rows: (data ?? []) as LiveMinuteRow[], at: Date.now() }
    },
  })
  const compareWeekQuery = useQuery({
    queryKey: ["live", tenantId, mode, "compare-7d"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_version_compare", {
        p_tenant: tenantId,
        p_since: new Date(Date.now() - 7 * 24 * HOUR).toISOString(),
        p_mode: mode,
      })
      if (error) throw new Error(error.message)
      return versionTable((data ?? []) as VersionCompareRow[])
    },
  })
  // The last hour's events seed the stream (and the country list) so the page isn't blank until the next INSERT.
  const seedQuery = useQuery({
    queryKey: ["live", tenantId, mode, "seed"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paywall_events")
        .select(EVENT_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("mode", mode)
        .gte("occurred_at", new Date(Date.now() - HOUR).toISOString())
        .order("occurred_at", { ascending: false })
        .limit(200)
      if (error) throw new Error(error.message)
      return (data ?? []) as LiveEvent[]
    },
  })

  const [streamed, setStreamed] = useState<LiveEvent[]>([])
  const [status, setStatus] = useState<string>("CONNECTING")
  useEffect(() => {
    setStreamed([])
    if (!tenantId) return
    const channel = supabase
      .channel(`live-events:${tenantId}:${mode}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "paywall_events", filter: `tenant_id=eq.${tenantId}` },
        (payload) => {
          const row = payload.new as LiveEvent
          if (row.mode !== mode) return
          setStreamed((buf) => pushEvent(buf, row))
        },
      )
      .subscribe((s) => setStatus(s))
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, tenantId, mode])

  // Seed then stream, one buffer: newest first, deduped, 200 kept.
  const events = useMemo(
    () => (seedQuery.data ?? []).reduceRight((buf, e) => pushEvent(buf, e), streamed),
    [seedQuery.data, streamed],
  )

  const versionOptions = distinct((compareWeekQuery.data ?? []).map((r) => r.app_version))
  const countryOptions = distinct(events.map((e) => e.country))
  const visibleEvents = events.filter(
    (e) => (version === null || e.app_version === version) && (country === null || e.country === country),
  )

  // ponytail: with a country picked, counters come from the loaded events (≤ 200 + streamed) — the RPCs carry no
  // country; add p_country to paywall_version_compare if exact per-country counters are needed.
  const counters: LiveCounters | null = country
    ? countersFromEvents(visibleEvents, Date.now() - HOUR)
    : compareHourQuery.data
      ? countersFromCompare(compareHourQuery.data, version)
      : null
  const series = minutesQuery.data ? minuteSeries(minutesQuery.data.rows, minutesQuery.data.at, version) : null
  const live = status === "SUBSCRIBED"

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4 pt-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight text-ink-900">Live</h1>
            <span
              data-testid="live-status"
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${
                live ? "bg-success-50 text-success-700 ring-success-200" : "bg-warning-50 text-warning-700 ring-warning-200"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${live ? "bg-success-500 animate-pulse" : "bg-warning-500"}`} />
              {live ? "Live" : "Reconnecting"}
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-500">Paywall traffic as it happens · {mode} mode · counters refresh every minute.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Filter label="App version" value={version} options={versionOptions} onChange={setVersion} />
          <Filter label="Country" value={country} options={countryOptions} onChange={setCountry} />
        </div>
      </div>

      {/* Last 60 minutes */}
      <section aria-labelledby="live-counters-h" className="space-y-4">
        <h3 id="live-counters-h" className="text-lg font-bold tracking-tight text-ink-900">Last 60 minutes</h3>
        {counters ? (
          <CounterGrid c={counters} />
        ) : compareHourQuery.isError ? (
          <LoadError what="the last hour" error={compareHourQuery.error} retry={() => compareHourQuery.refetch()} />
        ) : (
          <LoadingCard label="Loading the last hour…" rows={2} />
        )}
        {minutesQuery.isPending ? (
          <LoadingCard label="Loading per-minute traffic…" rows={3} />
        ) : minutesQuery.isError ? (
          <LoadError what="per-minute traffic" error={minutesQuery.error} retry={() => minutesQuery.refetch()} />
        ) : (
          <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-4 text-xs text-ink-500">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#7C3AED]" />Paywall views</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#22c55e]" />Purchases</span>
              <span className="ml-auto">per minute{country ? " · all countries" : ""}</span>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={series ?? []} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" fontSize={10} interval={9} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="views" name="Paywall views" stroke="#7C3AED" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="purchases" name="Purchases" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Version comparison, last 7 days */}
      <section aria-labelledby="live-versions-h" className="space-y-4">
        <div>
          <h3 id="live-versions-h" className="text-lg font-bold tracking-tight text-ink-900">Versions — last 7 days</h3>
          <p className="mt-0.5 text-xs text-ink-500">Newest first · change vs the next-older version</p>
        </div>
        {compareWeekQuery.isPending ? (
          <LoadingCard label="Loading versions…" rows={4} />
        ) : compareWeekQuery.isError ? (
          <LoadError what="versions" error={compareWeekQuery.error} retry={() => compareWeekQuery.refetch()} />
        ) : compareWeekQuery.data.length === 0 ? (
          <EmptyState icon={<Activity className="h-5 w-5" />} title="No versions reported yet" description="App versions appear once an app on SDK with version reporting opens the paywall." />
        ) : (
          <VersionTable rows={compareWeekQuery.data} />
        )}
      </section>

      {/* Event stream */}
      <section aria-labelledby="live-stream-h" className="space-y-4">
        <h3 id="live-stream-h" className="text-lg font-bold tracking-tight text-ink-900">Event stream</h3>
        {seedQuery.isPending ? (
          <LoadingCard label="Loading recent events…" rows={5} />
        ) : seedQuery.isError && streamed.length === 0 ? (
          <LoadError what="recent events" error={seedQuery.error} retry={() => seedQuery.refetch()} />
        ) : visibleEvents.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title={live ? "Waiting for events" : "Connecting…"}
            description="New paywall events appear here the moment an app sends them."
          />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm">
            <table className="min-w-full text-sm" data-testid="live-stream">
              <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>
                  {["Time", "Event", "Version", "Country", "Platform", "Reason"].map((h) => (
                    <th key={h} className="px-4 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visibleEvents.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-4 py-2 tabular-nums text-ink-500">{time(e.occurred_at)}</td>
                    <td className="px-4 py-2 font-medium text-ink-900">{eventLabel(e.name, e.reason)}</td>
                    <td className="px-4 py-2 text-ink-700">{e.app_version ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-700">{e.country ?? "—"}</td>
                    <td className="px-4 py-2 text-ink-700">{e.platform}</td>
                    <td className="px-4 py-2 text-ink-500">{e.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string | null
  options: string[]
  onChange: (v: string | null) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-medium text-ink-600">
      {label}
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="rounded-md border border-ink-200 bg-white px-2 py-1 text-sm text-ink-900"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

function CounterGrid({ c }: { c: LiveCounters }) {
  const tiles: [string, number][] = [
    ["Paywall views", c.paywallViews],
    ["Purchases", c.purchases],
    ["Sign-ins ok", c.signInsOk],
    ["Sign-ins failed", c.signInsFailed],
    ["Restores found", c.restoresFound],
    ["Restores not found", c.restoresNotFound],
    ["Device-limit views", c.deviceLimitViews],
  ]
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 xl:grid-cols-7" data-testid="live-counters">
      {tiles.map(([label, n]) => (
        <div key={label} className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-ink-500">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-ink-900">{n.toLocaleString()}</p>
        </div>
      ))}
    </div>
  )
}

/** A fraction-point change, green when it moves the good way. */
function Delta({ v, higherIsBetter }: { v: number | null; higherIsBetter: boolean }) {
  if (v === null || v === 0) return null
  const good = higherIsBetter ? v > 0 : v < 0
  return (
    <span className={`ml-1.5 text-xs font-semibold ${good ? "text-success-600" : "text-danger-600"}`}>
      {v > 0 ? "+" : "−"}
      {Math.abs(v * 100).toFixed(1)} pt
    </span>
  )
}

function VersionTable({ rows }: { rows: VersionRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm">
      <table className="min-w-full text-sm" data-testid="live-versions">
        <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
          <tr>
            {["Version", "Devices", "Purchase rate", "Sign-in fail share", "Restores found / not found", "Device transfers"].map((h) => (
              <th key={h} className="px-4 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((r) => (
            <tr key={r.app_version ?? "unreported"}>
              <td className="px-4 py-2 font-medium text-ink-900">{r.app_version ?? "Not reported"}</td>
              <td className="px-4 py-2 tabular-nums">{r.devices.toLocaleString()}</td>
              <td className="px-4 py-2 tabular-nums">
                {pct(r.purchase_rate)}
                <Delta v={r.purchaseRateDelta} higherIsBetter />
              </td>
              <td className="px-4 py-2 tabular-nums">
                {pct(r.failShare)}
                <Delta v={r.failShareDelta} higherIsBetter={false} />
              </td>
              <td className="px-4 py-2 tabular-nums">
                {r.restores_found.toLocaleString()} / {r.restores_not_found.toLocaleString()}
              </td>
              <td className="px-4 py-2 tabular-nums">{r.device_transfers.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
