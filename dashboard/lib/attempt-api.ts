// The attempt-observability read API (paycraft-attempt-observability GOAL D13 / AC-17): one body per endpoint,
// shared by every caller that must see the same answer.
//
//   GET /api/v1/attempts          listAttemptsResponse      attempts, filterable, paged
//   GET /api/v1/attempts/{id}     attemptResponse           one attempt + its attempt_events timeline
//   GET /api/v1/payment-health    paymentHealthResponse     failure / abandon / nudge-reach aggregates
//   GET /api/v1/funnel            funnelResponse            the 4-stage paywall funnel by distinct buyers
//
// Callers: the /api/v1 routes (an API key, authenticated by withApiKey — what the `paycraft` MCP tools invoke)
// and the dashboard AI (a signed-in member, through the same MCP tool rows — lib/ai/tools-bridge.ts). Each body
// takes the tenant ALREADY RESOLVED by its caller's authentication plus the request URL as an API caller would
// send it; the URL's own `tenant_id` is never read here, so no parameter can widen a caller's reach.
//
// The numbers come from Phase 5's libraries — lib/attempts.ts, lib/payment-health.ts, lib/funnel.ts — so the
// API, the MCP tools, the dashboard AI and the Analytics / subscriber pages cannot disagree about a definition.
// No body selects `user_ref`, an email or a provider id: an agent gets attempt facts, never who the buyer was.

import { NextResponse } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { queryFailed } from "@/lib/api-security"
import { pageFrom } from "@/lib/api-v1-helpers"
import {
  ATTEMPT_COLUMNS,
  ATTEMPT_STAGES,
  ATTEMPT_STATES,
  type AttemptEventRow,
  buyerRef,
  fetchAttemptEvents,
} from "@/lib/attempts"
import { paymentHealth } from "@/lib/payment-health"
import { ALL_TIME_DAYS, fetchFunnelStats, funnelFromStats, splitsFromStats } from "@/lib/funnel"
import { joinedAnalytics } from "@/lib/analytics-joined"
import type { Ga4Account } from "@/lib/ga4"

/** The view migration 212 adds over payment_attempts (210): every column the list returns plus `country`. */
export const ATTEMPTS_VIEW = "payment_attempts_geo"
export const ATTEMPT_LIST_COLUMNS = `${ATTEMPT_COLUMNS}, country`

export const DEFAULT_WINDOW_DAYS = 30
/** The tier when the tenant's plan names none — the same fallback the Analytics page uses. */
const FALLBACK_RETENTION_DAYS = 7
const DAY_MS = 86_400_000
const ATTEMPT_ID = /^[A-Za-z0-9_.:-]{1,160}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COUNTRY = /^[A-Za-z]{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type Mode = "live" | "test"

export type Window = { since: string; until: string }
export type ClampedWindow = Window & { capped: boolean; retention_days: number }

const invalid = (error: string, detail: string) => NextResponse.json({ error, detail }, { status: 400 })

/** `mode` (default live) or a 400. A test-mode row answers a different question convincingly, so it is explicit. */
export function parseMode(q: URLSearchParams): Mode | NextResponse {
  const raw = q.get("mode")
  if (raw === null || raw === "") return "live"
  return raw === "live" || raw === "test" ? raw : invalid("invalid_mode", "mode must be live or test")
}

/**
 * `since` (inclusive) / `until` (exclusive), each a date or an ISO-8601 instant. Absent `until` = now; absent
 * `since` = `defaultDays` before `until`. A bound that does not parse, or an empty window, is a 400 — never
 * silently replaced, because a caller who asked about "yesterday" must not be answered about the last month.
 */
export function parseWindow(q: URLSearchParams, now: Date, defaultDays = DEFAULT_WINDOW_DAYS): Window | NextResponse {
  const at = (name: "since" | "until"): Date | null | NextResponse => {
    const raw = q.get(name)
    if (raw === null || raw === "") return null
    const ms = Date.parse(raw)
    return Number.isNaN(ms) ? invalid("invalid_window", `${name} must be an ISO-8601 date or instant`) : new Date(ms)
  }
  const until = at("until")
  if (until instanceof NextResponse) return until
  const since = at("since")
  if (since instanceof NextResponse) return since
  const u = until ?? now
  const s = since ?? new Date(u.getTime() - defaultDays * DAY_MS)
  if (s.getTime() >= u.getTime()) return invalid("invalid_window", "since must be before until")
  return { since: s.toISOString(), until: u.toISOString() }
}

/** The plan's analytics retention, in days — the cap every aggregate window honours (D15). */
export async function retentionDays(sb: SupabaseClient, tenantId: string): Promise<number> {
  const { data: tenant, error } = await sb.from("tenants").select("plan").eq("id", tenantId).maybeSingle()
  if (error) throw new Error(`tenants: ${error.message}`)
  const { data: tier, error: tierError } = await sb
    .from("tier_definitions")
    .select("analytics_retention_days")
    .eq("tier_name", (tenant as { plan?: string | null } | null)?.plan ?? "free")
    .maybeSingle()
  if (tierError) throw new Error(`tier_definitions: ${tierError.message}`)
  return (tier as { analytics_retention_days?: number | null } | null)?.analytics_retention_days ?? FALLBACK_RETENTION_DAYS
}

/** Pull `since` forward to the retention horizon; the response says so rather than pretending the data exists. */
export function clampWindow(w: Window, retention: number, now: Date): ClampedWindow {
  const horizon = new Date(now.getTime() - retention * DAY_MS).toISOString()
  const capped = w.since < horizon
  const since = capped ? horizon : w.since
  return { since, until: w.until > since ? w.until : since, capped, retention_days: retention }
}

function oneOf<T extends string>(q: URLSearchParams, name: string, allowed: readonly T[]): T | null | NextResponse {
  const raw = q.get(name)
  if (raw === null || raw === "") return null
  return (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : invalid(`invalid_${name}`, `${name} must be one of ${allowed.join(", ")}`)
}

const isResponse = (v: unknown): v is NextResponse => v instanceof NextResponse

/** GET /api/v1/attempts — newest first, `{ data, pagination }` like every v1 list. */
export async function listAttemptsResponse(sb: SupabaseClient, tenantId: string, url: URL): Promise<Response> {
  const q = url.searchParams
  const state = oneOf(q, "state", ATTEMPT_STATES)
  if (isResponse(state)) return state
  const stage = oneOf(q, "stage", ATTEMPT_STAGES)
  if (isResponse(stage)) return stage
  const correlation = oneOf(q, "correlation", ["exact", "inferred"] as const)
  if (isResponse(correlation)) return correlation
  const mode = q.get("mode") ? parseMode(q) : null
  if (isResponse(mode)) return mode
  const country = q.get("country")
  if (country && !COUNTRY.test(country)) return invalid("invalid_country", "country must be an ISO 3166-1 alpha-2 code")
  const user = q.get("user")
  if (user && !EMAIL.test(user)) return invalid("invalid_user", "user must be the buyer's email address")
  const bound = (name: "since" | "until"): string | null | NextResponse => {
    const raw = q.get(name)
    if (!raw) return null
    const ms = Date.parse(raw)
    return Number.isNaN(ms) ? invalid("invalid_window", `${name} must be an ISO-8601 date or instant`) : new Date(ms).toISOString()
  }
  const since = bound("since")
  if (isResponse(since)) return since
  const until = bound("until")
  if (isResponse(until)) return until
  const { limit, offset } = pageFrom(q)

  let query = sb
    .from(ATTEMPTS_VIEW)
    .select(ATTEMPT_LIST_COLUMNS, { count: "exact" })
    // The tenant comes from the caller's authentication, never from the URL.
    .eq("tenant_id", tenantId)
  if (state) query = query.eq("state", state)
  if (stage) query = query.eq("stage", stage)
  if (correlation) query = query.eq("correlation", correlation)
  if (mode) query = query.eq("mode", mode)
  const provider = q.get("provider")
  if (provider) query = query.eq("provider", provider)
  if (country) query = query.eq("country", country.toUpperCase())
  // The buyer is matched on the same hash the attempts carry; the email itself never reaches the query.
  if (user) query = query.eq("user_ref", await buyerRef(tenantId, user))
  if (since) query = query.gte("started_at", since)
  if (until) query = query.lt("started_at", until)

  const { data, error, count } = await query.order("started_at", { ascending: false }).range(offset, offset + limit - 1)
  if (error) return queryFailed("v1/attempts", error)
  const rows = data ?? []
  return NextResponse.json({
    data: rows,
    pagination: {
      limit,
      offset,
      total: count ?? null,
      has_more: count !== null ? offset + rows.length < count : rows.length === limit,
    },
  })
}

/** GET /api/v1/attempts/{id} — by the row id (UUID) or by the attempt_id the SDK / stitcher assigned. */
export async function attemptResponse(sb: SupabaseClient, tenantId: string, id: string | undefined): Promise<Response> {
  if (!id || !ATTEMPT_ID.test(id)) {
    return invalid("invalid_attempt_id", "id must be the attempt's id or attempt_id (1-160 of A-Z a-z 0-9 _ . : -)")
  }
  const find = (column: "id" | "attempt_id") =>
    sb.from(ATTEMPTS_VIEW).select(ATTEMPT_LIST_COLUMNS).eq("tenant_id", tenantId).eq(column, id).maybeSingle()

  let found = UUID.test(id) ? await find("id") : { data: null, error: null }
  if (found.error) return queryFailed("v1/attempts/[id]", found.error)
  if (!found.data) found = await find("attempt_id")
  if (found.error) return queryFailed("v1/attempts/[id]", found.error)
  if (!found.data) return NextResponse.json({ error: "not_found" }, { status: 404 })

  const row = found.data as unknown as Record<string, unknown> & { attempt_id: string | null }
  let events: AttemptEventRow[] = []
  if (row.attempt_id) {
    try {
      events = (await fetchAttemptEvents(sb, tenantId, [row.attempt_id])).get(row.attempt_id) ?? []
    } catch (e) {
      return queryFailed("v1/attempts/[id]:events", { message: (e as Error).message })
    }
  }
  return NextResponse.json({ ...row, events })
}

/** GET /api/v1/payment-health — over `since`..`until` (default the last 30 days), capped at the plan's retention. */
export async function paymentHealthResponse(
  sb: SupabaseClient,
  tenantId: string,
  url: URL,
  now: Date = new Date(),
): Promise<Response> {
  const mode = parseMode(url.searchParams)
  if (isResponse(mode)) return mode
  const asked = parseWindow(url.searchParams, now)
  if (isResponse(asked)) return asked
  try {
    const window = clampWindow(asked, await retentionDays(sb, tenantId), now)
    const health = await paymentHealth(sb, tenantId, mode, window.since, window.until)
    return NextResponse.json({ mode, window, ...health })
  } catch (e) {
    return queryFailed("v1/payment-health", { message: (e as Error).message })
  }
}

const ANALYTICS_DAYS = [7, 30, 90, ALL_TIME_DAYS] as const
const PLATFORMS = ["android", "ios", "web", "desktop", "macos"] as const
const APP_VERSION = /^[0-9A-Za-z._+-]{1,32}$/
const PLAN_SKU = /^[a-z0-9][a-z0-9._-]{0,99}$/

/**
 * GET /api/v1/analytics — the joined Analytics report (paycraft-ga4-analytics-audit): PayCraft's provider-truth
 * funnel, Payment health and the tenant's GA4 segments under ONE filter set — the shape the dashboard, the MCP and
 * /idea-paycraft-analytics read. `days` 7 / 30 / 90 (default 30, capped at the plan's retention); filters `platform`,
 * `country` (ISO alpha-2), `app_version`, `plan` (a SKU). No buyer identifier is ever in the body.
 */
export async function analyticsResponse(
  sb: SupabaseClient,
  tenantId: string,
  url: URL,
  deps: { account: Ga4Account | null; segments?: Parameters<typeof joinedAnalytics>[4]["segments"] },
): Promise<Response> {
  const q = url.searchParams
  const mode = parseMode(q)
  if (isResponse(mode)) return mode
  const daysRaw = q.get("days")
  const days = daysRaw === "all" ? ALL_TIME_DAYS : daysRaw ? Number(daysRaw) : 30
  if (!(ANALYTICS_DAYS as readonly number[]).includes(days)) return invalid("invalid_days", "days must be 7, 30, 90 or all")
  const platform = q.get("platform")?.toLowerCase() || undefined
  if (platform && !(PLATFORMS as readonly string[]).includes(platform)) {
    return invalid("invalid_platform", `platform must be one of ${PLATFORMS.join(", ")}`)
  }
  const country = q.get("country") || undefined
  if (country && !COUNTRY.test(country)) return invalid("invalid_country", "country must be an ISO 3166-1 alpha-2 code")
  const appVersion = q.get("app_version") || undefined
  if (appVersion && !APP_VERSION.test(appVersion)) return invalid("invalid_app_version", "app_version is the app's version string")
  const plan = q.get("plan") || undefined
  if (plan && !PLAN_SKU.test(plan)) return invalid("invalid_plan", "plan must be a catalogue SKU")
  try {
    const retention = await retentionDays(sb, tenantId)
    const effective = Math.min(days, retention)
    const report = await joinedAnalytics(
      sb,
      tenantId,
      mode,
      { days: effective, platform, country: country?.toUpperCase(), appVersion, plan },
      deps,
    )
    return NextResponse.json({
      mode,
      ...report,
      window: { ...report.window, capped: effective < days, retention_days: retention },
    })
  } catch (e) {
    return queryFailed("v1/analytics", { message: (e as Error).message })
  }
}

const FINDING_KIND = /^[a-z0-9_]{1,64}$/
const FINDING_SEVERITY = ["critical", "high", "medium", "low"] as const
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
export const FINDING_COLUMNS =
  "id,kind,severity,title,summary,proposed_fix,status,fixed_note,fixed_at,source,window_start,window_end,evidence,created_at,updated_at"

/**
 * GET /api/v1/analytics/findings — the AI audit's findings (migration 216): open ones by default, `status=all` for
 * every one. What /idea-paycraft-analytics drains: each open finding is fixed at its source and resolved.
 */
export async function findingsListResponse(sb: SupabaseClient, tenantId: string, url: URL): Promise<Response> {
  const status = url.searchParams.get("status") ?? "open"
  if (!["open", "fixed", "dismissed", "all"].includes(status)) return invalid("invalid_status", "status must be open, fixed, dismissed or all")
  let q = sb.from("analytics_findings").select(FINDING_COLUMNS).eq("tenant_id", tenantId)
  if (status !== "all") q = q.eq("status", status)
  const { data, error } = await q.order("created_at", { ascending: false }).limit(200)
  if (error) return queryFailed("v1/analytics/findings", error)
  return NextResponse.json({ data: data ?? [] })
}

/** POST /api/v1/analytics/findings — record (or refresh) a finding /idea-paycraft-analytics found. analytics:write. */
export async function findingsUpsertResponse(sb: SupabaseClient, tenantId: string, req: Request): Promise<Response> {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return invalid("invalid_body", "a JSON finding is required")
  const kind = String(b.kind ?? "")
  const severity = String(b.severity ?? "")
  const title = String(b.title ?? "").trim()
  if (!FINDING_KIND.test(kind)) return invalid("invalid_kind", "kind is snake_case, 1-64 characters")
  if (!(FINDING_SEVERITY as readonly string[]).includes(severity)) return invalid("invalid_severity", "severity is critical, high, medium or low")
  if (!title || title.length > 200) return invalid("invalid_title", "title is 1-200 characters")
  if (!DATE_ONLY.test(String(b.window_start)) || !DATE_ONLY.test(String(b.window_end))) {
    return invalid("invalid_window", "window_start and window_end are YYYY-MM-DD dates")
  }
  const { data, error } = await sb.rpc("analytics_finding_upsert", {
    p_tenant_id: tenantId,
    p_kind: kind,
    p_severity: severity,
    p_title: title,
    p_summary: typeof b.summary === "string" ? b.summary.slice(0, 2000) : null,
    p_evidence: b.evidence && typeof b.evidence === "object" ? b.evidence : {},
    p_proposed_fix: typeof b.proposed_fix === "string" ? b.proposed_fix.slice(0, 2000) : null,
    p_source: "command",
    p_window_start: b.window_start,
    p_window_end: b.window_end,
  })
  if (error) return queryFailed("v1/analytics/findings:upsert", error)
  return NextResponse.json({ id: data }, { status: 201 })
}

/** PATCH /api/v1/analytics/findings — resolve one of the caller's findings with what was done. analytics:write. */
export async function findingsResolveResponse(sb: SupabaseClient, tenantId: string, req: Request): Promise<Response> {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const id = String(b?.id ?? "")
  const status = String(b?.status ?? "")
  const note = String(b?.note ?? "").trim()
  if (!UUID.test(id)) return invalid("invalid_id", "id is the finding's UUID")
  if (!["fixed", "dismissed", "open"].includes(status)) return invalid("invalid_status", "status is fixed, dismissed or open")
  if (status !== "open" && !note) return invalid("note_required", "say what was done (or why it was dismissed)")
  const { data, error } = await sb.rpc("analytics_finding_resolve", { p_tenant_id: tenantId, p_id: id, p_status: status, p_note: note })
  if (error) return queryFailed("v1/analytics/findings:resolve", error)
  if (data !== true) return NextResponse.json({ error: "not_found" }, { status: 404 })
  return NextResponse.json({ id, status })
}

/** GET /api/v1/funnel — distinct buyers per stage, plus the per-country and per-provider splits. */
export async function funnelResponse(sb: SupabaseClient, tenantId: string, url: URL, now: Date = new Date()): Promise<Response> {
  const mode = parseMode(url.searchParams)
  if (isResponse(mode)) return mode
  const asked = parseWindow(url.searchParams, now)
  if (isResponse(asked)) return asked
  try {
    const window = clampWindow(asked, await retentionDays(sb, tenantId), now)
    // Aggregated in SQL (migration 213): no API row cap; Paid = provider-confirmed purchases. Buyer hashes
    // never leave the database.
    const stats = await fetchFunnelStats(sb, tenantId, mode, window.since, window.until)
    const { byCountry, byProvider } = splitsFromStats(stats)
    return NextResponse.json({
      mode,
      window,
      stages: funnelFromStats(stats),
      by_country: byCountry,
      by_provider: byProvider,
    })
  } catch (e) {
    return queryFailed("v1/funnel", { message: (e as Error).message })
  }
}
