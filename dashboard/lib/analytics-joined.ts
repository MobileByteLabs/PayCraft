// The joined Analytics report (paycraft-ga4-analytics-audit sub-plan 02, GOAL D2–D5): ONE filter set narrows
//   · PayCraft's provider-truth funnel   paywall_funnel_stats (migrations 213 + 215) — Paid = what providers confirmed
//   · Payment health                     payment_attempts + timeline (platform / country)
//   · GA4 behaviour                      ga4Segments, restricted to the tenant's own streams
// The Analytics page, /api/v1/analytics (API keys → the MCP and /idea-paycraft-analytics) and the AI read this one
// shape, so they cannot disagree. A missing GA4 connection is a status, never zeros.

import type { SupabaseClient } from "@supabase/supabase-js"
import { type FunnelStats, fetchFunnelStats } from "@/lib/funnel"
import { type AnalyticsFilters, type Ga4Account, type Ga4Segments, ga4Segments } from "@/lib/ga4"
import { type PaymentHealth, paymentHealth } from "@/lib/payment-health"

export type Ga4Status = "ok" | "not_set_up" | "not_connected" | "error"

export type JoinedAnalytics = {
  filters: AnalyticsFilters
  window: { days: number; since: string }
  paycraft: FunnelStats
  health: PaymentHealth
  /** Payment health cannot apply these (no reliable plan / app version on an attempt). */
  healthNotApplied: string[]
  ga4: Extract<Ga4Segments, { ok: true }> | null
  ga4Status: Ga4Status
  ga4Error?: { error: string; fix?: string }
}

type Deps = {
  /** PayCraft's GA4 reader, or null when this server has none (PAYCRAFT_GA4_SA_JSON unset). */
  account: Ga4Account | null
  segments?: typeof ga4Segments
  now?: () => number
}

export async function joinedAnalytics(
  sb: SupabaseClient,
  tenantId: string,
  mode: "live" | "test",
  filters: AnalyticsFilters,
  deps: Deps,
): Promise<JoinedAnalytics> {
  const since = new Date((deps.now ?? Date.now)() - filters.days * 86_400_000).toISOString()
  const scope = { platform: filters.platform, country: filters.country, appVersion: filters.appVersion, plan: filters.plan }

  const ga4Read = async (): Promise<Pick<JoinedAnalytics, "ga4" | "ga4Status" | "ga4Error">> => {
    if (!deps.account) return { ga4: null, ga4Status: "not_set_up" }
    const { data: conn, error } = await sb
      .from("tenant_ga4_connections")
      .select("property_id,verified_at,stream_ids")
      .eq("tenant_id", tenantId)
      .maybeSingle()
    if (error) return { ga4: null, ga4Status: "error", ga4Error: { error: "ga4_connection_read_failed" } }
    const c = conn as { property_id: string; verified_at: string | null; stream_ids: string[] | null } | null
    if (!c?.verified_at) return { ga4: null, ga4Status: "not_connected" }
    const account = deps.account
    const res = await (deps.segments ?? ga4Segments)(c.property_id, c.stream_ids ?? [], filters, {
      token: account.token,
      saEmail: account.email,
    })
    return res.ok
      ? { ga4: res, ga4Status: "ok" }
      : { ga4: null, ga4Status: "error", ga4Error: { error: res.error, ...(res.fix ? { fix: res.fix } : {}) } }
  }

  const [paycraft, health, ga4] = await Promise.all([
    fetchFunnelStats(sb, tenantId, mode, since, undefined, scope),
    paymentHealth(sb, tenantId, mode, since, undefined, { platform: filters.platform, country: filters.country }),
    ga4Read(),
  ])
  return {
    filters,
    window: { days: filters.days, since },
    paycraft,
    health,
    healthNotApplied: [filters.plan && "plan", filters.appVersion && "app_version"].filter((x): x is string => !!x),
    ...ga4,
  }
}
