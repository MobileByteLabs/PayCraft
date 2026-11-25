// supabase/functions/_shared/ga4-report.ts
//
// One week of an app's GA4 paywall behaviour for the weekly digest (paycraft-ga4-analytics-audit sub-plan 04) — the
// server-side twin of the dashboard's `ga4Segments` (dashboard/lib/ga4.ts): the same reports, the same stream
// restriction (a GA4 property can hold other apps — Reels Downloader's holds 17), the same folding of GA4's
// "(not set)" / "(other)" into `unknown`. Read with PayCraft's org service account (PAYCRAFT_GA4_SA_JSON, the vault
// alias paycraft-ga4-service-account). Aggregates only: counts per step and per platform / country / app version.
//
// Best effort by design: no account, no connection, or any GA4 error returns null and the digest goes on with
// PayCraft's own data — a GA4 outage must never cost an owner their weekly note.

import { googleServiceAccountToken, type ServiceAccount } from "./play-jwt.ts"

const SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
const API = () => Deno.env.get("PAYCRAFT_GA4_API_BASE") ?? "https://analyticsdata.googleapis.com"
const STEPS = ["paycraft_paywall_view", "paycraft_plan_select", "paycraft_checkout_start", "paycraft_purchase_success"] as const
const VIEW = "paycraft_paywall_view"
const CHECKOUT = "paycraft_checkout_start"

export type Ga4Segment = { key: string; viewers: number; checkouts: number }
export type Ga4Week = {
  /** Users per paywall step. */
  funnel: Record<(typeof STEPS)[number], number>
  byPlatform: Ga4Segment[]
  byCountry: Ga4Segment[]
  byAppVersion: Ga4Segment[]
}

type Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }

const n = (v: string | undefined) => Number(v ?? 0) || 0
const keep = (k: string) => (!k || /^\(.*\)$/.test(k.trim()) ? "unknown" : k)

function parseSa(raw: string): ServiceAccount | null {
  if (!raw) return null
  try {
    const text = raw.trimStart().startsWith("{") ? raw : atob(raw.trim())
    const sa = JSON.parse(text) as ServiceAccount
    return sa.client_email && sa.private_key ? sa : null
  } catch {
    return null
  }
}

/** The tenant's GA4 week [start..end] (inclusive dates), or null when GA4 cannot answer. */
export async function ga4WeekForTenant(
  conn: { property_id: string; stream_ids: string[] | null } | null,
  start: string,
  end: string,
  saRaw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Ga4Week | null> {
  const sa = parseSa(saRaw)
  if (!conn?.property_id || !sa) return null
  try {
    const token = await googleServiceAccountToken(sa, SCOPE, fetchImpl)
    const streams = conn.stream_ids?.length ? [{ filter: { fieldName: "streamId", inListFilter: { values: conn.stream_ids } } }] : []
    const within = (extra: unknown) => {
      const all = [...streams, extra]
      return all.length === 1 ? all[0] : { andGroup: { expressions: all } }
    }
    const run = async (dimensions: string[], events: readonly string[]): Promise<Row[]> => {
      const res = await fetchImpl(`${API()}/v1beta/properties/${encodeURIComponent(conn.property_id)}:runReport`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: start, endDate: end }],
          dimensions: dimensions.map((name) => ({ name })),
          metrics: [{ name: "totalUsers" }],
          dimensionFilter: within({ filter: { fieldName: "eventName", inListFilter: { values: [...events] } } }),
          limit: 50,
        }),
      })
      if (!res.ok) throw new Error(`ga4 ${res.status}`)
      return ((await res.json()) as { rows?: Row[] }).rows ?? []
    }
    const segments = (rows: Row[], norm: (k: string) => string): Ga4Segment[] => {
      const acc = new Map<string, Ga4Segment>()
      for (const r of rows) {
        const key = norm(keep(r.dimensionValues?.[0]?.value ?? ""))
        const s = acc.get(key) ?? { key, viewers: 0, checkouts: 0 }
        const ev = r.dimensionValues?.[1]?.value
        if (ev === VIEW) s.viewers += n(r.metricValues?.[0]?.value)
        if (ev === CHECKOUT) s.checkouts += n(r.metricValues?.[0]?.value)
        acc.set(key, s)
      }
      return [...acc.values()].sort((a, b) => b.viewers - a.viewers || a.key.localeCompare(b.key)).slice(0, 8)
    }
    const [funnel, platform, country, version] = await Promise.all([
      run(["eventName"], STEPS),
      run(["platform", "eventName"], [VIEW, CHECKOUT]),
      run(["countryId", "eventName"], [VIEW, CHECKOUT]),
      run(["appVersion", "eventName"], [VIEW, CHECKOUT]),
    ])
    const users = new Map(funnel.map((r) => [r.dimensionValues?.[0]?.value ?? "", n(r.metricValues?.[0]?.value)]))
    return {
      funnel: Object.fromEntries(STEPS.map((s) => [s, users.get(s) ?? 0])) as Ga4Week["funnel"],
      byPlatform: segments(platform, (k) => k.toLowerCase()),
      byCountry: segments(country, (k) => (k === "unknown" ? k : k.toUpperCase())),
      byAppVersion: segments(version, (k) => k),
    }
  } catch (e) {
    console.warn("[ga4-report] GA4 unavailable for this digest:", (e as Error).message)
    return null
  }
}
