// Google Analytics 4 on the dashboard's Analytics page (paycraft-paywall-analytics GOAL D4 / AC-12).
//
// PayCraft reads a tenant's GA4 property through the free GA4 Data API with ONE platform service account
// (vault alias `paycraft-ga4-service-account` → env PAYCRAFT_GA4_SA_JSON). The tenant grants it access by adding its
// email as a Viewer on their property — no per-tenant secret is ever stored (tenant_ga4_connections holds only the
// property id). The account needs no GCP roles; reading is authorised by the GA4 Viewer grant alone.
// PAYCRAFT_GA4_API_BASE overrides the Data API host (a proxy, or the e2e stand-in in tests/ga4-connect.spec.ts).

import { googleAccessToken, type PlayServiceAccountJson } from "@/lib/store-jwt"

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"

export type Ga4Deps = { token: () => Promise<string>; saEmail: string; fetch?: typeof fetch }

export type Ga4ReportRequest = {
  dateRanges?: { startDate: string; endDate: string }[]
  dimensions?: { name: string }[]
  metrics: { name: string }[]
  dimensionFilter?: unknown
  orderBys?: unknown[]
  limit?: number
}

export type Ga4Row = { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }

export type Ga4Result = { ok: true; rows: Ga4Row[]; withheld: boolean } | { ok: false; error: string; fix?: string }

/** One GA4 Data API report for [propertyId]. 403 = PayCraft is not a Viewer there — the fix says so. */
export async function runReport(propertyId: string, req: Ga4ReportRequest, deps: Ga4Deps): Promise<Ga4Result> {
  const f = deps.fetch ?? fetch
  let res: Response
  try {
    res = await f(`${process.env.PAYCRAFT_GA4_API_BASE ?? "https://analyticsdata.googleapis.com"}/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: "POST",
      headers: { authorization: `Bearer ${await deps.token()}`, "content-type": "application/json" },
      body: JSON.stringify(req),
    })
  } catch {
    return { ok: false, error: "ga4_unreachable" }
  }
  if (res.status === 403) {
    return { ok: false, error: "no_access", fix: `Add ${deps.saEmail} as a Viewer on GA4 property ${propertyId}.` }
  }
  if (!res.ok) return { ok: false, error: `ga4_${res.status}` }
  const body = (await res.json()) as { rows?: Ga4Row[]; metadata?: { subjectToThresholding?: boolean; dataLossFromOtherRow?: boolean } }
  return {
    ok: true,
    rows: body.rows ?? [],
    // Google hides small counts (thresholding) or folds them into "(other)": show "withheld", never 0.
    withheld: Boolean(body.metadata?.subjectToThresholding || body.metadata?.dataLossFromOtherRow),
  }
}

export type Ga4Account = { email: string; token: () => Promise<string> }

/**
 * PayCraft's GA4 reader from the environment, or null when this PayCraft server has none set up. Tokens are minted
 * with the read-only Analytics scope and reused until five minutes before they expire.
 */
export function paycraftGa4Account(
  raw: string | undefined = process.env.PAYCRAFT_GA4_SA_JSON,
  mint: (sa: PlayServiceAccountJson, scope: string) => Promise<string> = googleAccessToken,
): Ga4Account | null {
  if (!raw) return null
  let sa: PlayServiceAccountJson
  try {
    // The org's Firebase service account is kept base64-encoded (FIREBASE_CREDS_B64); raw JSON works too.
    const text = raw.trimStart().startsWith("{") ? raw : atob(raw.trim())
    sa = JSON.parse(text) as PlayServiceAccountJson
  } catch {
    return null
  }
  if (!sa?.client_email || !sa?.private_key) return null
  let cached: { token: string; until: number } | null = null
  return {
    email: sa.client_email,
    token: async () => {
      if (cached && Date.now() < cached.until) return cached.token
      const token = await mint(sa, GA4_SCOPE)
      cached = { token, until: Date.now() + 55 * 60_000 }
      return token
    },
  }
}

export type Ga4Overview =
  | {
    ok: true
    totals: { activeUsers: number; sessions: number; paywallViews: number }
    totalsWithheld: boolean
    daily: { date: string; users: number }[]
    events: { event: string; country: string; count: number }[]
    eventsWithheld: boolean
  }
  | { ok: false; error: string; fix?: string }

const n = (v: string | undefined) => Number(v ?? 0) || 0

/** What the Analytics page shows for [rangeDays]: totals, users per day, PayCraft's paywall events by country. */
export async function ga4Overview(propertyId: string, rangeDays: number, deps: Ga4Deps): Promise<Ga4Overview> {
  const dateRanges = [{ startDate: `${rangeDays}daysAgo`, endDate: "today" }]
  const paycraftOnly = { filter: { fieldName: "eventName", stringFilter: { matchType: "BEGINS_WITH", value: "paycraft_" } } }
  const [totals, daily, events] = await Promise.all([
    runReport(propertyId, { dateRanges, metrics: [{ name: "activeUsers" }, { name: "sessions" }] }, deps),
    runReport(propertyId, { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }] }, deps),
    runReport(propertyId, {
      dateRanges,
      dimensions: [{ name: "eventName" }, { name: "country" }],
      metrics: [{ name: "eventCount" }],
      dimensionFilter: paycraftOnly,
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 50,
    }, deps),
  ])
  for (const r of [totals, daily, events]) if (!r.ok) return r
  if (!totals.ok || !daily.ok || !events.ok) return { ok: false, error: "ga4_unknown" }
  const t = totals.rows[0]?.metricValues ?? []
  const eventRows = events.rows.map((r) => ({
    event: r.dimensionValues?.[0]?.value ?? "",
    country: r.dimensionValues?.[1]?.value ?? "",
    count: n(r.metricValues?.[0]?.value),
  }))
  return {
    ok: true,
    totals: {
      activeUsers: n(t[0]?.value),
      sessions: n(t[1]?.value),
      paywallViews: eventRows.filter((e) => e.event === "paycraft_paywall_view").reduce((s, e) => s + e.count, 0),
    },
    totalsWithheld: totals.withheld,
    daily: daily.rows
      .map((r) => {
        const d = r.dimensionValues?.[0]?.value ?? ""
        return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, users: n(r.metricValues?.[0]?.value) }
      })
      .sort((a, b) => a.date.localeCompare(b.date)),
    events: eventRows,
    eventsWithheld: events.withheld,
  }
}

export { ga4ErrorMessage } from "@/lib/ga4-messages"
