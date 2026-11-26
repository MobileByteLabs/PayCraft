// supabase/functions/attempt-insights/engine.ts
//
// The weekly AI insight over a tenant's purchase attempts (paycraft-attempt-observability D13 / D15, AC-18):
//
//   1. attempt_insights_due        tenants with a budget, live attempts last ISO week, and nothing recorded yet
//   2. attempt_insights_aggregate  that week's numbers (and the week before, for the trend) — COUNTS ONLY
//   3. budget                      this month's spend + the worst case this call could cost must fit the budget,
//                                  checked here (no call when it cannot fit) and again, atomically, by
//                                  attempt_insights_reserve, which holds the worst case on the ledger
//   4. the model                   an aggregates-only prompt (buildPrompt), structured JSON answer
//   5. attempt_insights_complete   the real cost replaces the reservation; a refusal stays billed
//   6. deliverAlert                kind ai_insight, one per tenant per ISO week (dedupe key ai-insight-<YYYY-Www>),
//                                  through every channel the owner enabled (_shared/alert-channels.ts)
//
// Privacy (D15): the prompt is built from typed aggregate fields only, and every bucket key / error code must
// look like a provider id, an ISO country, a stage or an error code — anything else (an email, a hash, an attempt
// or provider id that leaked into a key) is dropped before it can reach the model.
//
// The model client, the database and the alert channels' fetch / email sender are all injected: the edge entry
// (handler.ts) passes the real ones, tests pass fakes.

import { type AlertDraft, type ChannelDeps, deliverAlert } from "../_shared/alert-channels.ts"
import type { Ga4Segment, Ga4Week } from "../_shared/ga4-report.ts"

// deno-lint-ignore no-explicit-any
type Any = any

/** Output budget for one summary, thinking included (adaptive thinking at effort low). */
export const MAX_TOKENS = 2048

/**
 * USD per million tokens, first-party Claude API rates. Only models a tenant may select (migration 212's
 * tenants_ai_insights_model_known CHECK) need a row; a server-side fallback answered by any other model is priced
 * at FALLBACK_CEILING, which is at least every current model's rate — so the ledger can over-count, never under.
 */
export const PRICES: Readonly<Record<string, { input: number; output: number; cacheRead: number }>> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  // Haiku 5.5's rate for prompts up to 100K tokens; a weekly summary prompt is ~1K.
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
}
export const FALLBACK_CEILING = { input: 10, output: 50, cacheRead: 1 } as const
/** Cache writes bill at 1.25x the input rate. */
const CACHE_WRITE_MULTIPLIER = 1.25

export interface Bucket {
  total: number
  failed: number
}

/** attempt_insights_aggregate (migration 212): counts over live attempts that started in the window. */
export interface Aggregate {
  total: number
  granted: number
  failed: number
  paid_not_granted: number
  abandoned: number
  open: number
  failures_by_stage: Record<string, number>
  by_provider: Record<string, Bucket>
  by_country: Record<string, Bucket>
  top_failure_codes: Array<{ stage: string; code: string; count: number }>
  nudge_scheduled: number
  nudge_skipped_no_permission: number
}

export interface IsoWeek {
  /** e.g. 2026-W47 */
  label: string
  /** Monday (UTC) the week starts, YYYY-MM-DD */
  weekStart: string
  since: string
  until: string
  /** Start of the week before, for the trend line. */
  prevSince: string
}

export interface LlmUsage {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export interface LlmIteration extends LlmUsage {
  type: string
  model?: string
}

export interface LlmResult {
  /** The model that produced the returned content (a server-side fallback may differ from the request). */
  model: string
  stopReason: string | null
  text: string
  usage: LlmUsage
  /** Per-hop usage when the API reports it (a fallback-served turn); null otherwise. */
  iterations: LlmIteration[] | null
}

export interface LlmRequest {
  model: string
  system: string
  prompt: string
  maxTokens: number
  schema: Record<string, unknown>
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResult>
}

const DAY_MS = 86_400_000

/** The last COMPLETE ISO week before `now` (Monday 00:00 UTC → next Monday 00:00 UTC). */
export function previousIsoWeek(now: Date): IsoWeek {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const isoDow = new Date(today).getUTCDay() || 7 // Monday = 1 … Sunday = 7
  const thisMonday = today - (isoDow - 1) * DAY_MS
  const start = new Date(thisMonday - 7 * DAY_MS)
  // ISO week-year: the year of that week's Thursday.
  const thursday = new Date(start.getTime() + 3 * DAY_MS)
  const year = thursday.getUTCFullYear()
  const jan4 = Date.UTC(year, 0, 4)
  const week1Monday = jan4 - (((new Date(jan4).getUTCDay() || 7) - 1) * DAY_MS)
  const week = Math.floor((start.getTime() - week1Monday) / (7 * DAY_MS)) + 1
  return {
    label: `${year}-W${String(week).padStart(2, "0")}`,
    weekStart: start.toISOString().slice(0, 10),
    since: start.toISOString(),
    until: new Date(thisMonday).toISOString(),
    prevSince: new Date(start.getTime() - 7 * DAY_MS).toISOString(),
  }
}

// Shapes a bucket key or error code may take to be sent to the model. Everything else is dropped.
const PROVIDER_KEY = /^[a-z][a-z0-9_]{1,39}$/
const COUNTRY_KEY = /^(?:[A-Z]{2}|unknown)$/
const STAGE_KEY = /^(?:sdk|server|provider|webhook|entitlement|unknown)$/
const CODE_KEY = /^[a-z][a-z0-9_.]{1,47}$/
const count = (n: unknown) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.trunc(Number(n)) : 0)
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`)

function bucketLines(buckets: Record<string, Bucket> | null | undefined, keyShape: RegExp): string[] {
  return Object.entries(buckets ?? {})
    .filter(([k]) => keyShape.test(k))
    .map(([k, b]) => ({ k, total: count(b?.total), failed: count(b?.failed) }))
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total || a.k.localeCompare(b.k))
    .slice(0, 15)
    .map((b) => `  ${b.k}: ${b.failed} of ${b.total} failed (${pct(b.failed, b.total)})`)
}

const PLATFORM_KEY = /^(?:[a-z]{2,12}|unknown)$/
const VERSION_KEY = /^(?:[0-9A-Za-z._+-]{1,32})$/

function ga4Lines(label: string, rows: Ga4Segment[], keyShape: RegExp): string[] {
  const kept = rows.filter((r) => keyShape.test(r.key) && (r.viewers > 0 || r.checkouts > 0)).slice(0, 8)
  return kept.length ? [`${label}:`, ...kept.map((r) => `  ${r.key} ${count(r.viewers)} viewers / ${count(r.checkouts)} checkouts`)] : []
}

/**
 * The app's GA4 week (paycraft-ga4-analytics-audit sub-plan 04): users per paywall step and the top segments, from
 * the tenant's own streams. Same privacy rule as the aggregates: keys must look like a platform, an ISO country or
 * a version string, counts are numbers — nothing else reaches the model.
 */
function ga4Block(g: Ga4Week): string[] {
  const f = g.funnel
  return [
    "",
    "GA4 (the app's own analytics, users not buyers):",
    `GA4 users this week: paywall_view ${count(f.paycraft_paywall_view)}, plan_select ${count(f.paycraft_plan_select)}, checkout_start ${count(f.paycraft_checkout_start)}, purchase_success ${count(f.paycraft_purchase_success)}`,
    ...ga4Lines("GA4 by platform", g.byPlatform, PLATFORM_KEY),
    ...ga4Lines("GA4 by country", g.byCountry, COUNTRY_KEY),
    ...ga4Lines("GA4 by app version", g.byAppVersion, VERSION_KEY),
  ]
}

function weekBlock(a: Aggregate): string[] {
  const reachDen = count(a.nudge_scheduled) + count(a.nudge_skipped_no_permission)
  const stages = Object.entries(a.failures_by_stage ?? {})
    .filter(([k]) => STAGE_KEY.test(k))
    .map(([k, v]) => `${k} ${count(v)}`)
  const codes = (a.top_failure_codes ?? [])
    .filter((c) => STAGE_KEY.test(String(c?.stage)) && CODE_KEY.test(String(c?.code)))
    .slice(0, 5)
    .map((c) => `  ${c.stage}/${c.code}: ${count(c.count)}`)
  return [
    `attempts: ${count(a.total)}`,
    `granted: ${count(a.granted)} (${pct(count(a.granted), count(a.total))})`,
    `failed: ${count(a.failed)}`,
    `paid_not_granted: ${count(a.paid_not_granted)}`,
    `abandoned: ${count(a.abandoned)}`,
    `still_open: ${count(a.open)}`,
    `failures_by_stage: ${stages.length ? stages.join(", ") : "none"}`,
    "by_provider:",
    ...bucketLines(a.by_provider, PROVIDER_KEY),
    "by_country:",
    ...bucketLines(a.by_country, COUNTRY_KEY),
    "top_failure_codes:",
    ...(codes.length ? codes : ["  none"]),
    `nudge_reach: ${reachDen === 0 ? "n/a" : `${Math.round((count(a.nudge_scheduled) / reachDen) * 100)}%`} (resume reminders scheduled ${count(a.nudge_scheduled)}, skipped for lack of notification permission ${count(a.nudge_skipped_no_permission)})`,
  ]
}

export const SYSTEM_PROMPT = [
  "You write the weekly payment-health note PayCraft sends to the owner of a subscription app.",
  "You receive only aggregate counts for the last ISO week and the week before it: no individual buyers, no",
  "identifiers. Write for a busy founder: name the one change that matters most, with its numbers, then what to",
  "do about it. Be concrete (provider, country, stage, error code) and do not speculate beyond the numbers; if",
  "the week was healthy, say so plainly. paid_not_granted means a buyer was charged but did not get access —",
  "always call it out when it is above zero. Answer in the JSON shape you are given: a one-sentence headline, up",
  "to 4 findings and up to 3 recommendations, each one sentence, plain text, no markdown. When GA4 lines are given,",
  "use them to say where users leave (platform, country, app version) — GA4 counts users, not purchases; Paid is",
  "only what the providers confirmed. List every problem worth fixing in `issues` (at most 5): a snake_case kind,",
  "a severity (critical | high | medium | low), a one-sentence title, the numbers that show it, and one concrete fix.",
].join(" ")

/** The prompt: the week and the week before, from typed aggregate fields only. */
export function buildPrompt(cur: Aggregate, prev: Aggregate | null, week: IsoWeek, ga4: Ga4Week | null = null): { system: string; user: string } {
  const prevLine = prev && count(prev.total) > 0
    ? `previous week: ${count(prev.total)} attempts, ${count(prev.granted)} granted, ${count(prev.failed)} failed, ${count(prev.paid_not_granted)} paid_not_granted, ${count(prev.abandoned)} abandoned`
    : "previous week: no data"
  const user = [
    `Week ${week.label} (${week.since.slice(0, 10)} to ${week.until.slice(0, 10)}, UTC, live mode):`,
    ...weekBlock(cur),
    prevLine,
    ...(ga4 ? ga4Block(ga4) : []),
    "",
    "Summarise this week for the owner.",
  ].join("\n")
  return { system: SYSTEM_PROMPT, user }
}

/** The structured answer the model must return (structured outputs: closed object). */
export const INSIGHT_SCHEMA = {
  type: "object",
  properties: {
    headline: { type: "string", description: "One sentence: the single most important change this week, with its numbers." },
    findings: { type: "array", items: { type: "string" }, description: "Up to 4 one-sentence findings." },
    recommendations: { type: "array", items: { type: "string" }, description: "Up to 3 one-sentence actions." },
    issues: {
      type: "array",
      description: "Up to 5 problems worth fixing — written to the owner's AI audit (analytics_findings).",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", description: "snake_case, e.g. product_not_found or abandon_at_plan_pick_id." },
          severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
          title: { type: "string" },
          evidence: { type: "string", description: "The numbers that show it." },
          proposed_fix: { type: "string" },
        },
        required: ["kind", "severity", "title", "evidence", "proposed_fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "findings", "recommendations"],
  additionalProperties: false,
} as const

export interface InsightIssue {
  kind: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  evidence: string
  proposed_fix: string
}

export interface Insight {
  headline: string
  findings: string[]
  recommendations: string[]
  /** Problems worth fixing, validated (bad severity / empty title dropped, kind folded to snake_case). */
  issues: InsightIssue[]
  /** headline + findings as stored and sent (≤ 4000 chars). */
  summary: string
}

const sentence = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "")

/** The model's JSON answer, bounded; null when it is not the structured answer. */
export function parseInsight(text: string): Insight | null {
  let raw: Any
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== "object") return null
  const headline = sentence(raw.headline, 300)
  if (!headline) return null
  const findings = (Array.isArray(raw.findings) ? raw.findings : []).map((f: unknown) => sentence(f, 400)).filter(Boolean).slice(0, 4)
  const recommendations = (Array.isArray(raw.recommendations) ? raw.recommendations : [])
    .map((r: unknown) => sentence(r, 400)).filter(Boolean).slice(0, 3)
  const summary = [headline, ...findings.map((f: string) => `- ${f}`)].join("\n").slice(0, 4000)
  const issues = (Array.isArray(raw.issues) ? raw.issues : [])
    .map((i: Any) => ({
      kind: sentence(i?.kind, 64).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64),
      severity: i?.severity,
      title: sentence(i?.title, 200),
      evidence: sentence(i?.evidence, 1000),
      proposed_fix: sentence(i?.proposed_fix, 1000),
    }))
    .filter((i: InsightIssue) => i.kind && i.title && ["critical", "high", "medium", "low"].includes(i.severity))
    .slice(0, 5)
  return { headline, findings, recommendations, summary, issues }
}

const priceOf = (model: string | undefined) => (model && PRICES[model]) || FALLBACK_CEILING

function usageCost(u: LlmUsage, rate: { input: number; output: number; cacheRead: number }): number {
  return (
    count(u.input_tokens) * rate.input +
    count(u.cache_creation_input_tokens) * rate.input * CACHE_WRITE_MULTIPLIER +
    count(u.cache_read_input_tokens) * rate.cacheRead +
    count(u.output_tokens) * rate.output
  ) / 1_000_000
}

/**
 * What a call cost in USD. With per-hop usage (a server-side fallback ran), each hop is priced at its own model:
 * `message` hops are the requested model, `fallback_message` names the model that served. Otherwise the whole
 * usage is the requested model's — unless the response says another model answered.
 */
export function costUsd(requestedModel: string, r: LlmResult): number {
  if (r.iterations && r.iterations.length) {
    return r.iterations.reduce((sum, it) => {
      if (it.type === "message") return sum + usageCost(it, priceOf(requestedModel))
      if (it.type === "fallback_message") return sum + usageCost(it, priceOf(it.model))
      // Any other hop kind is priced at the ceiling rather than ignored: it was billed.
      return sum + usageCost(it, FALLBACK_CEILING)
    }, 0)
  }
  return usageCost(r.usage, priceOf(r.model === requestedModel ? requestedModel : r.model))
}

/** Tokens a prompt can take, over-estimated (≈3 characters a token, plus the schema and framing). */
const promptTokens = (chars: number) => Math.ceil(chars / 3) + 600

/**
 * The most one summary can cost: the requested model reading the prompt and writing the full output budget, plus
 * a server-side fallback doing the same at the ceiling rate. Reserved before the call, so the budget holds even
 * in the worst case.
 */
export function estimateWorstCaseUsd(model: string, promptText: string): number {
  const inTok = promptTokens(promptText.length)
  const rate = priceOf(model)
  const one = (r: { input: number; output: number }) => (inTok * r.input + MAX_TOKENS * r.output) / 1_000_000
  return Math.ceil((one(rate) + one(FALLBACK_CEILING)) * 10_000) / 10_000
}

export interface RunDeps {
  now: Date
  channelDeps?: ChannelDeps
  /** Limit the run to one tenant (an operator re-run); every due tenant when absent. */
  tenantId?: string | null
  /** The tenant's GA4 week (paycraft-ga4-analytics-audit); null / absent = the digest runs on PayCraft data alone. */
  ga4?: (tenantId: string, week: IsoWeek) => Promise<Ga4Week | null>
}

export type SkipReason = "idle_week" | "budget_exhausted" | "already_recorded" | "model_refused" | "unparseable_answer" | "tenant_not_found"

export interface RunResult {
  week: string
  at: string
  due: number
  stored: number
  delivered: number
  spent_usd: number
  skipped: Array<{ tenant_id: string; reason: SkipReason }>
  /** A channel that did not take the alert; the ledger retries it (attempt-alerts' retry sweep). */
  delivery_failures: string[]
  errors: string[]
}

async function rpc<T>(db: Any, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

function alertDraft(tenantId: string, week: IsoWeek, insight: Insight, model: string, cost: number, agg: Aggregate, now: Date): AlertDraft {
  const recs = insight.recommendations.length ? `\n\nWhat to do:\n${insight.recommendations.map((r) => `- ${r}`).join("\n")}` : ""
  return {
    tenantId,
    kind: "ai_insight",
    severity: "digest",
    // tenant_alerts dedupes per (tenant, kind, key) for 24 h; the ledger's UNIQUE (tenant, week_start) makes it
    // once per week for good.
    dedupeKey: `ai-insight-${week.label}`,
    title: `Payment insights ${week.label}: ${insight.headline}`.slice(0, 200),
    body: `${insight.summary}${recs}`.slice(0, 4000),
    payload: {
      week: week.label,
      week_start: week.weekStart,
      model,
      cost_usd: cost,
      recommendations: insight.recommendations,
      totals: { attempts: agg.total, granted: agg.granted, failed: agg.failed, paid_not_granted: agg.paid_not_granted, abandoned: agg.abandoned },
    },
    at: now,
  }
}

/** One tenant's week. Returns the skip reason, or null when an insight was stored (and delivered when possible). */
async function runTenant(
  db: Any,
  llm: LlmClient,
  tenant: { tenant_id: string; budget_usd: number | string; model: string },
  week: IsoWeek,
  deps: RunDeps,
  result: RunResult,
): Promise<SkipReason | null> {
  const tenantId = tenant.tenant_id
  const cur = await rpc<Aggregate>(db, "attempt_insights_aggregate", { p_tenant_id: tenantId, p_since: week.since, p_until: week.until })
  if (!cur || count(cur.total) === 0) return "idle_week"
  const prev = await rpc<Aggregate>(db, "attempt_insights_aggregate", { p_tenant_id: tenantId, p_since: week.prevSince, p_until: week.since })

  const ga4 = deps.ga4 ? await deps.ga4(tenantId, week).catch(() => null) : null
  const { system, user } = buildPrompt(cur, prev, week, ga4)
  const worst = estimateWorstCaseUsd(tenant.model, system + user)
  const budget = Number(tenant.budget_usd)
  const spent = Number(await rpc<number | string>(db, "attempt_insights_month_spend_usd", { p_tenant_id: tenantId, p_at: deps.now.toISOString() }))
  // The cheap check: no reservation, no call, when the worst case cannot fit this month.
  if (!(spent + worst <= budget)) return "budget_exhausted"

  // The authoritative check: atomic under a per-tenant lock, holding the worst case on the ledger.
  const reserved = await rpc<{ id: string | null; reason?: string }>(db, "attempt_insights_reserve", {
    p_tenant_id: tenantId, p_week_start: week.weekStart, p_model: tenant.model, p_reserve_usd: worst, p_now: deps.now.toISOString(),
  })
  if (!reserved?.id) return (reserved?.reason as SkipReason) ?? "budget_exhausted"

  let answer: LlmResult
  try {
    answer = await llm.complete({ model: tenant.model, system, prompt: user, maxTokens: MAX_TOKENS, schema: INSIGHT_SCHEMA })
  } catch (e) {
    // Nothing was billed for a request that failed; the budget it held goes back and the week stays open.
    await rpc<boolean>(db, "attempt_insights_release", { p_id: reserved.id })
    throw e
  }

  // The real cost, never clipped to the reservation: the ledger must show what was billed.
  const cost = costUsd(tenant.model, answer)
  const insight = answer.stopReason === "refusal" ? null : parseInsight(answer.text)
  const usage = (answer.iterations?.length ? answer.iterations : [answer.usage]).reduce(
    (s, u) => ({ input: s.input + count(u.input_tokens), output: s.output + count(u.output_tokens) }),
    { input: 0, output: 0 },
  )
  await rpc<boolean>(db, "attempt_insights_complete", {
    p_id: reserved.id,
    p_status: insight ? "stored" : "refused",
    p_summary: insight?.summary ?? null,
    p_recommendations: insight?.recommendations ?? [],
    p_aggregates: cur,
    p_model_served: answer.model,
    p_input_tokens: usage.input,
    p_output_tokens: usage.output,
    p_cost_usd: cost,
    p_now: deps.now.toISOString(),
  })
  result.spent_usd += cost
  if (!insight) return answer.stopReason === "refusal" ? "model_refused" : "unparseable_answer"

  result.stored++
  // Each issue becomes a finding on the owner's AI audit (migration 216) — refreshed if this week's is already
  // there, never reopened once fixed. /idea-paycraft-analytics drains the open ones.
  const weekEnd = new Date(Date.parse(week.until) - 86_400_000).toISOString().slice(0, 10)
  for (const issue of insight.issues) {
    await rpc<string>(db, "analytics_finding_upsert", {
      p_tenant_id: tenantId, p_kind: issue.kind, p_severity: issue.severity, p_title: issue.title, p_summary: issue.evidence,
      p_evidence: { week: week.label }, p_proposed_fix: issue.proposed_fix, p_source: "digest",
      p_window_start: week.weekStart, p_window_end: weekEnd,
    }).catch((e: Error) => result.errors.push(`${tenantId}: finding ${issue.kind}: ${e.message}`))
  }
  const delivered = await deliverAlert(db, alertDraft(tenantId, week, insight, answer.model, cost, cur, deps.now), deps.channelDeps ?? {})
  if (delivered.alertId) {
    result.delivered++
    await rpc<boolean>(db, "attempt_insights_link_alert", { p_id: reserved.id, p_alert_id: delivered.alertId })
    for (const d of delivered.deliveries) {
      if (!d.ok) result.delivery_failures.push(`${tenantId}: ${d.channel} (${d.error ?? "unknown"})`)
    }
  }
  return null
}

/** The weekly run over every due tenant. One tenant failing never stops the others. */
export async function runInsights(db: Any, llm: LlmClient, deps: RunDeps): Promise<RunResult> {
  const week = previousIsoWeek(deps.now)
  const result: RunResult = { week: week.label, at: deps.now.toISOString(), due: 0, stored: 0, delivered: 0, spent_usd: 0, skipped: [], delivery_failures: [], errors: [] }
  const due = await rpc<Array<{ tenant_id: string; budget_usd: number | string; model: string }>>(db, "attempt_insights_due", {
    p_week_start: week.weekStart, p_since: week.since, p_until: week.until,
  })
  const tenants = (due ?? []).filter((t) => !deps.tenantId || t.tenant_id === deps.tenantId)
  result.due = tenants.length
  for (const t of tenants) {
    try {
      const skipped = await runTenant(db, llm, t, week, deps, result)
      if (skipped) result.skipped.push({ tenant_id: t.tenant_id, reason: skipped })
    } catch (e) {
      result.errors.push(`${t.tenant_id}: ${(e as Error).message || String(e)}`)
    }
  }
  result.spent_usd = Math.round(result.spent_usd * 10_000) / 10_000
  return result
}
