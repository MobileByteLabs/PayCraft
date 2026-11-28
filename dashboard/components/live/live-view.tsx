"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis } from "recharts"
import { Activity, ChevronDown, ChevronRight } from "lucide-react"
import { useDashboard } from "@/components/app-providers"
import { LoadError, LoadingCard } from "@/components/query-ui"
import { EmptyState } from "@/components/ui/empty-state"
import {
  ago,
  countersFromCompare,
  countersFromEvents,
  dateTime,
  describeEvent,
  distinct,
  exitLines,
  journeys,
  pushEvent,
  rangeOf,
  RANGES,
  seriesForRange,
  versionTable,
  type ExitStepRow,
  type Journey,
  type LiveCounters,
  type LiveEvent,
  type LiveSeriesRow,
  type RangeKey,
  type VersionCompareRow,
  type VersionRow,
} from "@/lib/live"

const EVENT_COLUMNS = "id,name,step,reason,provider,sku,trigger,device_ref,app_version,country,platform,mode,occurred_at"
const SEED_LIMIT = 200

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`)

/**
 * Live — paywall traffic over a chosen range (1 h … 30 d): counters, a bucketed chart, the per-version comparison,
 * where buyers leave, and the realtime activity as buyer journeys or single events, all in plain words.
 * (realtime-analytics spec, "Live page"; ranges + exits: migration 225.)
 */
export function LiveView() {
  const { tenantId, mode, supabase } = useDashboard()
  const [rangeKey, setRangeKey] = useState<RangeKey>("1h")
  const [version, setVersion] = useState<string | null>(null)
  const [country, setCountry] = useState<string | null>(null)
  const [view, setView] = useState<"journeys" | "events">("journeys")
  const [now, setNow] = useState(() => Date.now())
  const range = rangeOf(rangeKey)
  const refresh = range.key === "1h" ? 60_000 : 5 * 60_000

  // Re-render the "3 min ago" labels every 30 s.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const since = () => new Date(Date.now() - range.ms).toISOString()

  const compareQuery = useQuery({
    queryKey: ["live", tenantId, mode, "compare", range.key],
    refetchInterval: refresh,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_version_compare", { p_tenant: tenantId, p_since: since(), p_mode: mode })
      if (error) throw new Error(error.message)
      return (data ?? []) as VersionCompareRow[]
    },
  })
  const seriesQuery = useQuery({
    queryKey: ["live", tenantId, mode, "series", range.key],
    refetchInterval: refresh,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_live_series", {
        p_tenant: tenantId,
        p_since: since(),
        p_mode: mode,
        p_bucket: range.bucket,
      })
      if (error) throw new Error(error.message)
      return { rows: (data ?? []) as LiveSeriesRow[], at: Date.now() }
    },
  })
  const exitsQuery = useQuery({
    queryKey: ["live", tenantId, mode, "exits", range.key],
    refetchInterval: refresh,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("paywall_exit_steps", { p_tenant: tenantId, p_since: since(), p_mode: mode })
      if (error) throw new Error(error.message)
      return exitLines((data ?? []) as ExitStepRow[])
    },
  })
  // The newest events in the range seed the activity list (and the country filter) before the next INSERT arrives.
  const seedQuery = useQuery({
    queryKey: ["live", tenantId, mode, "seed", range.key],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("paywall_events")
        .select(EVENT_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("mode", mode)
        .gte("occurred_at", since())
        .order("occurred_at", { ascending: false })
        .limit(SEED_LIMIT)
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

  // Seed then stream, one buffer: newest first, deduped, capped.
  const events = useMemo(
    () => (seedQuery.data ?? []).reduceRight((buf, e) => pushEvent(buf, e), streamed),
    [seedQuery.data, streamed],
  )

  const versionOptions = distinct((compareQuery.data ?? []).map((r) => r.app_version))
  const countryOptions = distinct(events.map((e) => e.country))
  const visibleEvents = events.filter(
    (e) => (version === null || e.app_version === version) && (country === null || e.country === country),
  )
  const visits = useMemo(() => journeys(visibleEvents), [visibleEvents])

  // ponytail: with a country picked, counters come from the loaded events (≤ 200 + streamed) — the RPCs carry no
  // country; add p_country to paywall_version_compare if exact per-country counters are needed.
  const counters: LiveCounters | null = country
    ? countersFromEvents(visibleEvents, Date.now() - range.ms)
    : compareQuery.data
      ? countersFromCompare(compareQuery.data, version)
      : null
  const series = seriesQuery.data ? seriesForRange(seriesQuery.data.rows, seriesQuery.data.at, range, version) : null
  const versions = compareQuery.data ? versionTable(compareQuery.data) : null
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
          <p className="mt-1 text-sm text-ink-500">
            What buyers are doing right now · {mode} mode · refreshes every {range.key === "1h" ? "minute" : "5 minutes"}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Time range" className="flex rounded-lg border border-ink-200 bg-white p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                role="tab"
                aria-selected={r.key === range.key}
                onClick={() => setRangeKey(r.key)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${
                  r.key === range.key ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-50"
                }`}
              >
                {r.key}
              </button>
            ))}
          </div>
          <Filter label="App version" value={version} options={versionOptions} onChange={setVersion} />
          <Filter label="Country" value={country} options={countryOptions} onChange={setCountry} />
        </div>
      </div>

      {/* Counters + chart for the range */}
      <section aria-labelledby="live-counters-h" className="space-y-4">
        <h3 id="live-counters-h" className="text-lg font-bold tracking-tight text-ink-900">{range.label}</h3>
        {counters ? (
          <CounterGrid c={counters} />
        ) : compareQuery.isError ? (
          <LoadError what={range.label.toLowerCase()} error={compareQuery.error} retry={() => compareQuery.refetch()} />
        ) : (
          <LoadingCard label={`Loading ${range.label.toLowerCase()}…`} rows={2} />
        )}
        {seriesQuery.isPending ? (
          <LoadingCard label="Loading traffic…" rows={3} />
        ) : seriesQuery.isError ? (
          <LoadError what="traffic" error={seriesQuery.error} retry={() => seriesQuery.refetch()} />
        ) : (
          <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-4 text-xs text-ink-500">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#7C3AED]" />Paywall views</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-[#22c55e]" />Purchases</span>
              <span className="ml-auto">per {range.bucket}{country ? " · all countries" : ""}</span>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={series ?? []} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="label" fontSize={10} minTickGap={40} tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="views" name="Paywall views" stroke="#7C3AED" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="purchases" name="Purchases" stroke="#22c55e" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Where buyers leave */}
      <section aria-labelledby="live-exits-h" className="space-y-4">
        <div>
          <h3 id="live-exits-h" className="text-lg font-bold tracking-tight text-ink-900">Where buyers leave</h3>
          <p className="mt-0.5 text-xs text-ink-500">{range.label} · each exit point, by how many buyers left there</p>
        </div>
        {exitsQuery.isPending ? (
          <LoadingCard label="Loading exits…" rows={4} />
        ) : exitsQuery.isError ? (
          <LoadError what="exits" error={exitsQuery.error} retry={() => exitsQuery.refetch()} />
        ) : exitsQuery.data.length === 0 ? (
          <EmptyState icon={<Activity className="h-5 w-5" />} title="Nobody left the paywall in this range" description="Exit points appear here as soon as a buyer closes the paywall, the store sheet or an offer." />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm">
            <table className="min-w-full text-sm" data-testid="live-exits">
              <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                <tr>{["Where they left", "Buyers", "Times", "Share"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {exitsQuery.data.map((x) => (
                  <tr key={x.description}>
                    <td className="px-4 py-2 font-medium text-ink-900">{x.description}</td>
                    <td className="px-4 py-2 tabular-nums">{x.devices.toLocaleString()}</td>
                    <td className="px-4 py-2 tabular-nums text-ink-500">{x.exits.toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-ink-100">
                          <div className="h-1.5 rounded-full bg-danger-500" style={{ width: `${Math.round(x.share * 100)}%` }} />
                        </div>
                        <span className="tabular-nums text-xs text-ink-500">{Math.round(x.share * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Version comparison */}
      <section aria-labelledby="live-versions-h" className="space-y-4">
        <div>
          <h3 id="live-versions-h" className="text-lg font-bold tracking-tight text-ink-900">Versions</h3>
          <p className="mt-0.5 text-xs text-ink-500">{range.label} · newest first · change vs the next-older version</p>
        </div>
        {compareQuery.isPending ? (
          <LoadingCard label="Loading versions…" rows={4} />
        ) : compareQuery.isError ? (
          <LoadError what="versions" error={compareQuery.error} retry={() => compareQuery.refetch()} />
        ) : !versions || versions.length === 0 ? (
          <EmptyState icon={<Activity className="h-5 w-5" />} title="No versions reported yet" description="App versions appear once an app on SDK with version reporting opens the paywall." />
        ) : (
          <VersionTable rows={versions} />
        )}
      </section>

      {/* Activity: journeys or single events */}
      <section aria-labelledby="live-stream-h" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 id="live-stream-h" className="text-lg font-bold tracking-tight text-ink-900">Activity</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              The newest {SEED_LIMIT} events in the range, then everything that arrives live
            </p>
          </div>
          <div role="tablist" aria-label="Activity view" className="flex rounded-lg border border-ink-200 bg-white p-0.5">
            {(["journeys", "events"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-sm font-medium ${view === v ? "bg-brand-600 text-white" : "text-ink-600 hover:bg-ink-50"}`}
              >
                {v === "journeys" ? "Journeys" : "All events"}
              </button>
            ))}
          </div>
        </div>
        {seedQuery.isPending ? (
          <LoadingCard label="Loading recent activity…" rows={5} />
        ) : seedQuery.isError && streamed.length === 0 ? (
          <LoadError what="recent activity" error={seedQuery.error} retry={() => seedQuery.refetch()} />
        ) : visibleEvents.length === 0 ? (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title={live ? "Waiting for activity" : "Connecting…"}
            description="Buyers' actions appear here the moment an app sends them."
          />
        ) : view === "journeys" ? (
          <JourneyTable visits={visits} now={now} />
        ) : (
          <EventTable events={visibleEvents} now={now} />
        )}
      </section>
    </div>
  )
}

function When({ iso, now }: { iso: string; now: number }) {
  return (
    <div className="whitespace-nowrap">
      <div className="tabular-nums text-ink-700">{dateTime(iso)}</div>
      <div className="text-xs text-ink-400">{ago(iso, now)}</div>
    </div>
  )
}

function EventTable({ events, now }: { events: LiveEvent[]; now: number }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm">
      <table className="min-w-full text-sm" data-testid="live-stream">
        <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
          <tr>{["When", "What happened", "Version", "Country", "Platform"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {events.map((e) => (
            <tr key={e.id}>
              <td className="px-4 py-2"><When iso={e.occurred_at} now={now} /></td>
              <td className="px-4 py-2 font-medium text-ink-900">{describeEvent(e)}</td>
              <td className="px-4 py-2 text-ink-700">{e.app_version ?? "—"}</td>
              <td className="px-4 py-2 text-ink-700">{e.country ?? "—"}</td>
              <td className="px-4 py-2 text-ink-700">{e.platform}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JourneyTable({ visits, now }: { visits: Journey[]; now: number }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div className="overflow-x-auto rounded-xl border border-ink-200 bg-white shadow-sm">
      <table className="min-w-full text-sm" data-testid="live-journeys">
        <thead className="bg-ink-50 text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
          <tr>{["", "Last seen", "Buyer", "How it ended", "Steps", "Version", "Country"].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {visits.map((j) => {
            const expanded = open === j.key
            return (
              <Fragment key={j.key}>
                <tr className="cursor-pointer hover:bg-ink-50" onClick={() => setOpen(expanded ? null : j.key)}>
                  <td className="px-2 py-2 text-ink-400">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                  <td className="px-4 py-2"><When iso={j.end} now={now} /></td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-500">{j.device}</td>
                  <td className={`px-4 py-2 font-medium ${j.bought ? "text-success-700" : "text-ink-900"}`}>{j.outcome}</td>
                  <td className="px-4 py-2 tabular-nums text-ink-500">{j.events.length}</td>
                  <td className="px-4 py-2 text-ink-700">{j.app_version ?? "—"}</td>
                  <td className="px-4 py-2 text-ink-700">{j.country ?? "—"}</td>
                </tr>
                {expanded && (
                  <tr className="bg-ink-50/60">
                    <td />
                    <td colSpan={6} className="px-4 py-3">
                      <ol className="space-y-1.5">
                        {j.events.map((e, i) => (
                          <li key={e.id} className="flex gap-3 text-sm">
                            <span className="w-5 shrink-0 text-right tabular-nums text-ink-400">{i + 1}.</span>
                            <span className="w-44 shrink-0 tabular-nums text-ink-500">{dateTime(e.occurred_at)}</span>
                            <span className="text-ink-900">{describeEvent(e)}</span>
                          </li>
                        ))}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
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
              <td className="px-4 py-2 font-medium text-ink-900">{r.app_version === "unknown" || !r.app_version ? "Not reported (older app)" : r.app_version}</td>
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
