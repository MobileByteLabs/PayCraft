// attempt-insights (paycraft-attempt-observability D13 / D15, AC-18): the weekly AI summary of a tenant's purchase
// attempts, written from AGGREGATES ONLY, spending at most tenants.ai_insights_budget_usd per calendar month, and
// delivered through the owner alert channels (_shared/alert-channels.ts).
//
// The LLM is always a fake (no request leaves the process), and so are fetch and the email sender the alert
// channels use. The database is an in-memory stand-in for migration 212's RPCs (+ 211's alert RPCs); the SQL side
// of those — the atomic budget reservation, the aggregate, retention — is proven against real Postgres by
// supabase/tests/212_attempt_insights_test.sql.
// Run: deno test -A supabase/functions/__tests__/attempt-insights.test.ts
import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  type Aggregate,
  buildPrompt,
  costUsd,
  estimateWorstCaseUsd,
  INSIGHT_SCHEMA,
  type LlmClient,
  type LlmRequest,
  type LlmResult,
  MAX_TOKENS,
  parseInsight,
  previousIsoWeek,
  runInsights,
} from "../attempt-insights/engine.ts"
import { handleAttemptInsights } from "../attempt-insights/handler.ts"

type Row = Record<string, unknown>
const NOW = new Date("2026-11-23T09:00:00.000Z") // Monday 09:00 UTC — 211's paycraft_attempt_insights fires
const T1 = "11111111-1111-4111-8111-111111111111"
const T2 = "22222222-2222-4222-8222-222222222222"

const AGG: Aggregate = {
  total: 120, granted: 76, failed: 16, paid_not_granted: 2, abandoned: 24, open: 2,
  failures_by_stage: { provider: 10, server: 5, entitlement: 2, sdk: 1 },
  by_provider: { stripe: { total: 70, failed: 11 }, razorpay: { total: 50, failed: 7 } },
  by_country: { IN: { total: 40, failed: 9 }, US: { total: 60, failed: 6 }, unknown: { total: 20, failed: 3 } },
  top_failure_codes: [{ stage: "provider", code: "authentication_required", count: 6 }, { stage: "provider", code: "card_declined", count: 4 }],
  nudge_scheduled: 18, nudge_skipped_no_permission: 7,
}
const PREV: Aggregate = { ...AGG, total: 110, granted: 90, failed: 6, paid_not_granted: 0, abandoned: 14 }
const IDLE: Aggregate = {
  total: 0, granted: 0, failed: 0, paid_not_granted: 0, abandoned: 0, open: 0, failures_by_stage: {}, by_provider: {},
  by_country: {}, top_failure_codes: [], nudge_scheduled: 0, nudge_skipped_no_permission: 0,
}

const INSIGHT_JSON = JSON.stringify({
  headline: "Stripe failures in India tripled week over week.",
  findings: ["Failures rose from 6 to 18 of ~115 attempts.", "Most ended at the provider with authentication_required."],
  recommendations: ["Turn on 3-D Secure for Stripe India.", "Contact the 2 buyers who paid without getting access."],
})

/** A fake model: records every request, answers with `result` (or throws `error`). */
class FakeLlm implements LlmClient {
  requests: LlmRequest[] = []
  constructor(public result: Partial<LlmResult> | ((req: LlmRequest) => LlmResult) = {}, public error: Error | null = null) {}
  complete(req: LlmRequest): Promise<LlmResult> {
    this.requests.push(req)
    if (this.error) return Promise.reject(this.error)
    if (typeof this.result === "function") return Promise.resolve(this.result(req))
    return Promise.resolve({
      model: req.model, stopReason: "end_turn", text: INSIGHT_JSON,
      usage: { input_tokens: 1200, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      iterations: null, ...this.result,
    })
  }
}

interface TenantSeed { id: string; budget: number; model: string; spent: number; cur: Aggregate; prev: Aggregate }

/** Migration 212's RPCs + 211's alert RPCs, in memory, with the SQL's own rules for budget and dedupe. */
class FakeInsightsDb {
  calls: Array<{ fn: string; args: Row }> = []
  insights = new Map<string, Row>()
  alerts: Row[] = []
  deliveries: Row[] = []
  findings: Row[] = []
  constructor(public tenants: TenantSeed[]) {}

  rpc(fn: string, args: Row): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push({ fn, args })
    const ok = (data: unknown) => Promise.resolve({ data, error: null })
    const t = this.tenants.find((x) => x.id === args.p_tenant_id)
    switch (fn) {
      case "attempt_insights_due":
        return ok(this.tenants
          .filter((x) => x.budget > 0 && x.cur.total > 0)
          .filter((x) => ![...this.insights.values()].some((i) => i.tenant_id === x.id && i.week_start === args.p_week_start))
          .map((x) => ({ tenant_id: x.id, budget_usd: x.budget, model: x.model })))
      case "attempt_insights_aggregate":
        return ok(args.p_since === "2026-11-16T00:00:00.000Z" ? t!.cur : t!.prev)
      case "attempt_insights_month_spend_usd":
        return ok(t!.spent + [...this.insights.values()].filter((i) => i.tenant_id === t!.id).reduce((s, i) => s + Number(i.cost_usd), 0))
      case "attempt_insights_reserve": {
        if ([...this.insights.values()].some((i) => i.tenant_id === t!.id && i.week_start === args.p_week_start)) {
          return ok({ id: null, reason: "already_recorded" })
        }
        const spent = t!.spent + [...this.insights.values()].filter((i) => i.tenant_id === t!.id).reduce((s, i) => s + Number(i.cost_usd), 0)
        if (spent + Number(args.p_reserve_usd) > t!.budget) return ok({ id: null, reason: "budget_exhausted" })
        const id = crypto.randomUUID()
        this.insights.set(id, { id, tenant_id: t!.id, week_start: args.p_week_start, status: "reserved", cost_usd: args.p_reserve_usd, model: args.p_model })
        return ok({ id })
      }
      case "attempt_insights_complete": {
        const row = this.insights.get(String(args.p_id))
        if (!row || row.status !== "reserved") return ok(false)
        Object.assign(row, {
          status: args.p_status, summary: args.p_summary, recommendations: args.p_recommendations, aggregates: args.p_aggregates,
          model_served: args.p_model_served, input_tokens: args.p_input_tokens, output_tokens: args.p_output_tokens, cost_usd: args.p_cost_usd,
        })
        return ok(true)
      }
      case "analytics_finding_upsert":
        this.findings.push(args)
        return ok(crypto.randomUUID())
      case "attempt_insights_release":
        return ok(this.insights.delete(String(args.p_id)))
      case "attempt_insights_link_alert": {
        const row = this.insights.get(String(args.p_id))
        if (row) row.alert_id = args.p_alert_id
        return ok(!!row)
      }
      case "tenant_alert_record": {
        if (this.alerts.some((a) => a.tenant_id === args.p_tenant_id && a.kind === args.p_kind && a.dedupe_key === args.p_dedupe_key)) return ok(null)
        const id = crypto.randomUUID()
        this.alerts.push({ id, tenant_id: args.p_tenant_id, kind: args.p_kind, severity: args.p_severity, dedupe_key: args.p_dedupe_key, title: args.p_title, body: args.p_body, payload: args.p_payload })
        return ok(id)
      }
      case "tenant_alert_channels_decrypt":
        return ok([{ owner_email: "owner@app.test", email_enabled: true, inbox_enabled: true, slack_url: "https://hooks.slack.test/T/B/x", webhook_url: "https://owner.test/hook", webhook_secret: "pcwh_secret_0123456789" }])
      case "alert_delivery_record":
        this.deliveries.push({ alert_id: args.p_alert_id, channel: args.p_channel, ok: args.p_ok })
        return ok([{ status: args.p_ok ? "sent" : "failed", attempts: 1, next_retry_at: null }])
      default:
        return Promise.resolve({ data: null, error: { message: `fake db: unexpected rpc ${fn}` } })
    }
  }
  stored() {
    return [...this.insights.values()]
  }
}

const channelDeps = () => {
  const sent: string[] = []
  return {
    sent,
    deps: {
      fetch: (url: string | URL | Request) => {
        sent.push(String(url))
        return Promise.resolve(new Response("ok", { status: 200 }))
      },
      sendEmail: () => {
        sent.push("email")
        return Promise.resolve({ ok: true })
      },
      now: () => NOW,
    },
  }
}

const seed = (o: Partial<TenantSeed> = {}): TenantSeed => ({ id: T1, budget: 1.0, model: "claude-sonnet-5-5", spent: 0, cur: AGG, prev: PREV, ...o })

// ── prompt: aggregates only ────────────────────────────────────────────────────────────────────────────

Deno.test("prompt carries aggregates only — no user_ref, no email, no attempt or provider ids", () => {
  const { system, user } = buildPrompt(AGG, PREV, previousIsoWeek(NOW))
  const p = system + "\n" + user
  assertEquals(p.includes("user_ref"), false)
  assertEquals(p.includes("@"), false)
  assertStringIncludes(user, "paid_not_granted: 2")
  assertStringIncludes(user, "nudge_reach: 72%")
  assertStringIncludes(user, "stripe: 11 of 70 failed (15.7%)")
  assertStringIncludes(user, "IN: 9 of 40 failed (22.5%)")
  assertStringIncludes(user, "provider/authentication_required: 6")
  assertStringIncludes(user, "2026-W47")
  assertStringIncludes(user, "previous week: 110 attempts")
})

Deno.test("prompt drops any bucket key or code that is not a provider / country / error-code shape", () => {
  const poisoned: Aggregate = {
    ...AGG,
    by_provider: { ...AGG.by_provider, "buyer@example.com": { total: 1, failed: 1 } },
    by_country: { ...AGG.by_country, "user_ref=abc123": { total: 1, failed: 1 } },
    top_failure_codes: [...AGG.top_failure_codes, { stage: "provider", code: "cs_test_a1B2c3 buyer@example.com", count: 1 }],
    failures_by_stage: { ...AGG.failures_by_stage, "1732492800000-9f3c2a1b": 1 },
  }
  const { user } = buildPrompt(poisoned, null, previousIsoWeek(NOW))
  assertEquals(user.includes("@"), false)
  assertEquals(user.includes("user_ref"), false)
  assertEquals(user.includes("1732492800000-9f3c2a1b"), false)
  assertEquals(user.includes("cs_test_"), false)
  assertStringIncludes(user, "previous week: no data")
})

// ── week, money and parsing ────────────────────────────────────────────────────────────────────────────

Deno.test("previousIsoWeek: the last COMPLETE ISO week, Monday to Monday UTC", () => {
  assertEquals(previousIsoWeek(NOW), {
    label: "2026-W47", weekStart: "2026-11-16", since: "2026-11-16T00:00:00.000Z", until: "2026-11-23T00:00:00.000Z",
    prevSince: "2026-11-09T00:00:00.000Z",
  })
  // Sunday night is still inside W48, so the last complete week is still W47.
  assertEquals(previousIsoWeek(new Date("2026-11-29T23:59:00Z")).label, "2026-W47")
  // ISO week 1 of 2027 starts Monday 2027-01-04; the week before it is 2026-W53.
  assertEquals(previousIsoWeek(new Date("2027-01-04T09:00:00Z")).label, "2026-W53")
})

Deno.test("costUsd prices the requested model, a fallback hop at its own model, an unknown model at the ceiling", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  assertAlmostEquals(costUsd("claude-sonnet-5-5", { model: "claude-sonnet-5-5", stopReason: "end_turn", text: "", usage, iterations: null }), 12, 1e-9)
  assertAlmostEquals(costUsd("claude-opus-5-5", { model: "claude-opus-5-5", stopReason: "end_turn", text: "", usage, iterations: null }), 24, 1e-9)
  const hop = { input_tokens: 1_000_000, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
  const withFallback: LlmResult = {
    model: "claude-opus-5-5", stopReason: "end_turn", text: "", usage,
    iterations: [{ type: "message", ...hop }, { type: "fallback_message", model: "claude-opus-5-5", ...hop }],
  }
  assertAlmostEquals(costUsd("claude-sonnet-5-5", withFallback), 2 + 4, 1e-9)
  const unknown: LlmResult = { ...withFallback, iterations: [{ type: "fallback_message", model: "claude-future-9", ...hop }] }
  assertAlmostEquals(costUsd("claude-sonnet-5-5", unknown), 10, 1e-9)
})

Deno.test("the worst case covers the full output budget on the requested model plus a ceiling-priced fallback", () => {
  const { system, user } = buildPrompt(AGG, PREV, previousIsoWeek(NOW))
  const worst = estimateWorstCaseUsd("claude-sonnet-5-5", system + user)
  assert(worst >= (MAX_TOKENS * 10 + MAX_TOKENS * 50) / 1_000_000, `worst case ${worst} under-reserves`)
  assert(worst < 0.5, `worst case ${worst} would starve a 1.00 USD budget`)
})

Deno.test("parseInsight takes the structured answer and bounds it; prose is not an insight", () => {
  const i = parseInsight(INSIGHT_JSON)!
  assertEquals(i.recommendations.length, 2)
  assertStringIncludes(i.summary, "Stripe failures in India tripled")
  assertStringIncludes(i.summary, "- Most ended at the provider")
  assertEquals(parseInsight("Sure! Here is a summary…"), null)
  assertEquals(parseInsight(JSON.stringify({ headline: "", findings: [], recommendations: [] })), null)
  assertEquals(INSIGHT_SCHEMA.additionalProperties, false)
})

// ── the weekly run ─────────────────────────────────────────────────────────────────────────────────────

Deno.test("seeded week → one stored insight from aggregates only, cost on the ledger, delivered on every channel", async () => {
  const db = new FakeInsightsDb([seed()])
  const llm = new FakeLlm()
  const { deps, sent } = channelDeps()
  const out = await runInsights(db, llm, { now: NOW, channelDeps: deps })

  assertEquals(out.errors, [])
  assertEquals(out.stored, 1)
  assertEquals(llm.requests.length, 1)
  const req = llm.requests[0]
  assertEquals(req.model, "claude-sonnet-5-5")
  assertEquals(req.maxTokens, MAX_TOKENS)
  assertEquals((req.system + req.prompt).includes("@"), false)
  assertEquals((req.system + req.prompt).includes("user_ref"), false)

  const [row] = db.stored()
  assertEquals(row.status, "stored")
  assertEquals(row.week_start, "2026-11-16")
  assertAlmostEquals(Number(row.cost_usd), (1200 * 2 + 500 * 10) / 1_000_000, 1e-9)
  assertStringIncludes(String(row.summary), "Stripe failures in India tripled")
  assertEquals(row.aggregates, AGG)

  assertEquals(db.alerts.length, 1)
  assertEquals(db.alerts[0].kind, "ai_insight")
  assertEquals(db.alerts[0].severity, "digest")
  assertEquals(db.alerts[0].dedupe_key, "ai-insight-2026-W47")
  assertStringIncludes(String(db.alerts[0].body), "Turn on 3-D Secure for Stripe India.")
  assertEquals(row.alert_id, db.alerts[0].id)
  // One alert_deliveries row per enabled channel.
  assertEquals(db.deliveries.map((d) => d.channel).sort(), ["email", "inbox", "slack", "webhook"])
  assertEquals(sent.length, 3)
})

Deno.test("idle week → no LLM call, no row, no spend", async () => {
  const db = new FakeInsightsDb([seed({ cur: IDLE })])
  const llm = new FakeLlm()
  const out = await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  assertEquals(llm.requests.length, 0)
  assertEquals(out.stored, 0)
  assertEquals(db.stored().length, 0)
  assertEquals(db.calls.filter((c) => c.fn === "attempt_insights_reserve").length, 0)
})

Deno.test("a due tenant whose window turns out empty is skipped as idle, never billed", async () => {
  const db = new FakeInsightsDb([seed()])
  // The due list was computed, then the aggregate came back empty (attempts purged / moved between calls).
  db.tenants[0].cur = IDLE
  const origDue = db.rpc.bind(db)
  db.rpc = (fn: string, args: Row) =>
    fn === "attempt_insights_due" ? Promise.resolve({ data: [{ tenant_id: T1, budget_usd: 1, model: "claude-sonnet-5-5" }], error: null }) : origDue(fn, args)
  const llm = new FakeLlm()
  const out = await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  assertEquals(llm.requests.length, 0)
  assertEquals(out.skipped, [{ tenant_id: T1, reason: "idle_week" }])
})

Deno.test("budget stop — this month's spend + the worst case over the budget halts before the LLM call", async () => {
  const db = new FakeInsightsDb([seed({ spent: 1.0 })])
  const llm = new FakeLlm()
  const out = await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  assertEquals(llm.requests.length, 0)
  assertEquals(out.stored, 0)
  assertEquals(out.skipped, [{ tenant_id: T1, reason: "budget_exhausted" }])
  assertEquals(db.stored().length, 0)
  assertEquals(db.alerts.length, 0)
})

Deno.test("budget is never exceeded: spend after the run stays <= the budget even when it was nearly used up", async () => {
  const db = new FakeInsightsDb([seed({ spent: 0.8 })])
  const llm = new FakeLlm()
  await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  const spent = 0.8 + db.stored().reduce((s, r) => s + Number(r.cost_usd), 0)
  assert(spent <= 1.0, `spent ${spent} > budget 1.00`)
  assertEquals(llm.requests.length, 1)
})

Deno.test("a refusal is billed and kept on the ledger, but nothing is delivered", async () => {
  const db = new FakeInsightsDb([seed()])
  const llm = new FakeLlm({ stopReason: "refusal", text: "" })
  const out = await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  const [row] = db.stored()
  assertEquals(row.status, "refused")
  assert(Number(row.cost_usd) > 0)
  assertEquals(db.alerts.length, 0)
  assertEquals(out.skipped, [{ tenant_id: T1, reason: "model_refused" }])
})

Deno.test("an LLM failure releases the reservation, is reported, and does not stop the next tenant", async () => {
  const db = new FakeInsightsDb([seed(), seed({ id: T2 })])
  let n = 0
  const llm = new FakeLlm((req) => {
    if (++n === 1) throw new Error("529 overloaded")
    return { model: req.model, stopReason: "end_turn", text: INSIGHT_JSON, usage: { input_tokens: 1000, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, iterations: null }
  })
  const out = await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  assertEquals(out.errors.length, 1)
  assertStringIncludes(out.errors[0], "529 overloaded")
  assertEquals(out.stored, 1)
  assertEquals(db.stored().length, 1)
  assertEquals(db.stored()[0].tenant_id, T2)
  assertEquals(db.calls.filter((c) => c.fn === "attempt_insights_release").length, 1)
})

Deno.test("an unparseable answer stays billed on the ledger, is not delivered, and is reported", async () => {
  const db = new FakeInsightsDb([seed()])
  const llm = new FakeLlm({ text: "I cannot produce JSON today." })
  const out = await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  assertEquals(db.alerts.length, 0)
  assertEquals(db.stored()[0].status, "refused")
  assertEquals(out.skipped, [{ tenant_id: T1, reason: "unparseable_answer" }])
})

// ── the HTTP entry ─────────────────────────────────────────────────────────────────────────────────────

const serviceJwt = () => `x.${btoa(JSON.stringify({ role: "service_role" })).replace(/=+$/, "")}.y`

Deno.test("without ANTHROPIC_API_KEY the function refuses cleanly (503), touches nothing, and does not throw", async () => {
  let dbBuilt = 0
  const res = await handleAttemptInsights(
    new Request("https://fn.test/attempt-insights", { method: "POST", headers: { Authorization: `Bearer ${serviceJwt()}` } }),
    { env: (k) => (k === "ANTHROPIC_API_KEY" ? undefined : "x"), db: () => { dbBuilt++; return new FakeInsightsDb([]) }, llm: () => new FakeLlm() },
  )
  assertEquals(res.status, 503)
  const body = await res.json()
  assertEquals(body.error, "anthropic_key_missing")
  assertStringIncludes(body.detail, "mbs-claude-api-key-1")
  assertEquals(dbBuilt, 0)
})

Deno.test("only the service role may run it; a bad `now` is a 400", async () => {
  const deps = { env: () => "x", db: () => new FakeInsightsDb([]), llm: () => new FakeLlm() }
  const anon = await handleAttemptInsights(new Request("https://fn.test/attempt-insights", { method: "POST", headers: { Authorization: "Bearer x.e30.y" } }), deps)
  assertEquals(anon.status, 401)
  const bad = await handleAttemptInsights(
    new Request("https://fn.test/attempt-insights?now=someday", { method: "POST", headers: { Authorization: `Bearer ${serviceJwt()}` } }), deps)
  assertEquals(bad.status, 400)
})

Deno.test("a service-role run returns the outcome counts", async () => {
  const db = new FakeInsightsDb([seed()])
  const res = await handleAttemptInsights(
    new Request(`https://fn.test/attempt-insights?now=${NOW.toISOString()}`, { method: "POST", headers: { Authorization: `Bearer ${serviceJwt()}` } }),
    { env: () => "sk-ant-test", db: () => db, llm: () => new FakeLlm(), channelDeps: channelDeps().deps },
  )
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.week, "2026-W47")
  assertEquals(body.stored, 1)
})

// ── paycraft-ga4-analytics-audit sub-plan 04: GA4 in the prompt, findings to analytics_findings ─────────────

const GA4_WEEK = {
  funnel: { paycraft_paywall_view: 1088, paycraft_plan_select: 74, paycraft_checkout_start: 108, paycraft_purchase_success: 2 },
  byPlatform: [{ key: "android", viewers: 1080, checkouts: 107 }],
  byCountry: [{ key: "ID", viewers: 133, checkouts: 9 }, { key: "<script>", viewers: 1, checkouts: 0 }],
  byAppVersion: [{ key: "2.4.1", viewers: 900, checkouts: 80 }],
}

Deno.test("the app's GA4 week rides in the prompt as typed lines; a malformed key is dropped", async () => {
  const db = new FakeInsightsDb([seed()])
  const llm = new FakeLlm()
  const asked: string[] = []
  await runInsights(db, llm, {
    now: NOW,
    channelDeps: channelDeps().deps,
    ga4: (tenantId, week) => (asked.push(`${tenantId}:${week.weekStart}`), Promise.resolve(GA4_WEEK)),
  })
  assertEquals(asked, [`${T1}:2026-11-16`])
  const p = llm.requests[0].prompt
  assertStringIncludes(p, "GA4 users this week: paywall_view 1088, plan_select 74, checkout_start 108, purchase_success 2")
  assertStringIncludes(p, "ID 133 viewers / 9 checkouts")
  assertStringIncludes(p, "2.4.1 900 viewers / 80 checkouts")
  assertEquals(p.includes("<script>"), false)
})

Deno.test("the answer's issues become analytics_findings rows for the week (source digest)", async () => {
  const db = new FakeInsightsDb([seed()])
  const llm = new FakeLlm({
    text: JSON.stringify({
      headline: "Most Play purchases failed before checkout.",
      findings: ["69 of 89 failures were product_not_found."],
      recommendations: ["Check where the failing installs came from."],
      issues: [
        { kind: "Product Not Found!", severity: "critical", title: "40 buyers could not buy", evidence: "69 of 89 failures", proposed_fix: "Check install source" },
        { kind: "x", severity: "nonsense", title: "", evidence: "", proposed_fix: "" },
      ],
    }),
  })
  await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps })
  assertEquals(db.findings.length, 1)
  const f = db.findings[0]
  assertEquals(f.p_tenant_id, T1)
  assertEquals(f.p_kind, "product_not_found")
  assertEquals(f.p_severity, "critical")
  assertEquals(f.p_source, "digest")
  assertEquals(f.p_window_start, "2026-11-16")
  assertEquals(f.p_window_end, "2026-11-22")
  assertEquals(f.p_proposed_fix, "Check install source")
})

Deno.test("without GA4 the digest runs as before", async () => {
  const db = new FakeInsightsDb([seed()])
  const llm = new FakeLlm()
  const out = await runInsights(db, llm, { now: NOW, channelDeps: channelDeps().deps, ga4: () => Promise.resolve(null) })
  assertEquals(out.stored, 1)
  assertEquals(llm.requests[0].prompt.includes("GA4"), false)
})
