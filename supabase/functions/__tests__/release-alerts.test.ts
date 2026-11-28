// Release / funnel alerts + the Telegram channel (real-time analytics spec 2026-11-28, migration 224).
// The aggregates themselves are proven against Postgres by supabase/tests/224_release_alerts_telegram_test.sql;
// this suite pins the threshold decisions, the Telegram payload, and that the engine wires the rules and the
// sender delivers to Telegram without a Telegram failure failing anything. No network: fetch is injected.
// Run: deno test -A supabase/functions/__tests__/release-alerts.test.ts
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { type ChannelDeps, dispatchAlert, type StoredAlert, telegramRequest, telegramText } from "../_shared/alert-channels.ts"
import { hourKey, paywallSilentDraft, releaseRegressionDraft, signInFailingDraft } from "../attempt-alerts/analytics-rules.ts"
import { runCritical } from "../attempt-alerts/engine.ts"

const NOW = new Date("2026-11-28T10:07:00.000Z")
const T = "11111111-1111-4111-8111-111111111111"
const TOKEN = "123456789:AAH-telegram_secret_token_abcdefghijk"

const release = (o: Record<string, unknown> = {}) => ({
  tenant_id: T, app_version: "3.1.0", previous_version: "3.0.9",
  paywall_view_devices: 40, purchase_devices: 4, purchase_rate: 0.1,
  sign_in_fails: 2, sign_in_completes: 18, sign_in_fail_share: 0.1,
  prev_paywall_view_devices: 100, prev_purchase_devices: 15, prev_purchase_rate: 0.15,
  prev_sign_in_fails: 2, prev_sign_in_completes: 18, prev_sign_in_fail_share: 0.1,
  ...o,
})

// ── release_regression ────────────────────────────────────────────────────────────────────────────────
Deno.test("release_regression: purchase rate below half the previous fires, keyed by app_version", () => {
  const d = releaseRegressionDraft(release({ purchase_rate: 0.07 }), NOW)!
  assertEquals(d.kind, "release_regression")
  assertEquals(d.severity, "critical")
  assertEquals(d.dedupeKey, "3.1.0")
  assertStringIncludes(d.title, "purchase rate down")
  assertStringIncludes(d.body, "7.0% (4/40 devices) vs 15.0% (15/100)")
})

Deno.test("release_regression: exactly half (or better) does not fire", () => {
  assertEquals(releaseRegressionDraft(release({ purchase_rate: 0.075 }), NOW), null)
  assertEquals(releaseRegressionDraft(release(), NOW), null)
})

Deno.test("release_regression: sign-in fail share over 2x the previous fires; exactly 2x does not", () => {
  const d = releaseRegressionDraft(release({ sign_in_fails: 5, sign_in_fail_share: 0.21 }), NOW)!
  assertStringIncludes(d.title, "sign-in failures up")
  assertEquals(d.payload!.sign_in_rise, true)
  assertEquals(releaseRegressionDraft(release({ sign_in_fails: 5, sign_in_fail_share: 0.2 }), NOW), null)
})

Deno.test("release_regression: fewer than 5 sign-in failures never fires on share alone (0% previous)", () => {
  const zeroBefore = { prev_sign_in_fails: 0, prev_sign_in_fail_share: 0 }
  assertEquals(releaseRegressionDraft(release({ ...zeroBefore, sign_in_fails: 1, sign_in_fail_share: 0.05 }), NOW), null)
  assert(releaseRegressionDraft(release({ ...zeroBefore, sign_in_fails: 5, sign_in_fail_share: 0.2 }), NOW))
})

Deno.test("release_regression: < 30 paywall-view devices, no previous version, or undefined rates never fire", () => {
  assertEquals(releaseRegressionDraft(release({ paywall_view_devices: 29, purchase_rate: 0 }), NOW), null)
  assertEquals(releaseRegressionDraft(release({ previous_version: null, purchase_rate: 0 }), NOW), null)
  assertEquals(releaseRegressionDraft(release({ purchase_rate: 0, prev_purchase_rate: 0 }), NOW), null)
  assertEquals(releaseRegressionDraft(release({ sign_in_fail_share: 0.9, prev_sign_in_fail_share: null }), NOW), null)
})

Deno.test("release_regression: Postgres numerics arrive as strings and still decide correctly", () => {
  assert(releaseRegressionDraft(release({ purchase_rate: "0.0500", prev_purchase_rate: "0.1500" }), NOW))
})

// ── sign_in_failing ───────────────────────────────────────────────────────────────────────────────────
Deno.test("sign_in_failing: >= 5 failures and > 30% share fires, keyed by the hour", () => {
  const d = signInFailingDraft({ tenant_id: T, sign_in_fails: 5, sign_in_completes: 10, fails_by_provider: { google: 4, apple: 1 } }, NOW)!
  assertEquals(d.kind, "sign_in_failing")
  assertEquals(d.dedupeKey, "hour-2026-11-28T10")
  assertStringIncludes(d.title, "33.3%")
  assertStringIncludes(d.body, "By provider: google 4, apple 1")
})

Deno.test("sign_in_failing: 4 failures, or exactly 30%, does not fire", () => {
  assertEquals(signInFailingDraft({ tenant_id: T, sign_in_fails: 4, sign_in_completes: 0 }, NOW), null)
  assertEquals(signInFailingDraft({ tenant_id: T, sign_in_fails: 6, sign_in_completes: 14 }, NOW), null)
})

// ── paywall_silent ────────────────────────────────────────────────────────────────────────────────────
Deno.test("paywall_silent: 0 views against a mean >= 5 fires; any view or a mean < 5 does not", () => {
  const d = paywallSilentDraft({ tenant_id: T, paywall_views: 0, baseline_mean: "5.00" }, NOW)!
  assertEquals(d.kind, "paywall_silent")
  assertEquals(d.dedupeKey, hourKey(NOW))
  assertStringIncludes(d.body, "average of 5.0")
  assertEquals(paywallSilentDraft({ tenant_id: T, paywall_views: 1, baseline_mean: 50 }, NOW), null)
  assertEquals(paywallSilentDraft({ tenant_id: T, paywall_views: 0, baseline_mean: 4.99 }, NOW), null)
})

// ── Telegram payload ──────────────────────────────────────────────────────────────────────────────────
const alert = (o: Partial<StoredAlert> = {}): StoredAlert => ({
  id: "a1", tenant_id: T, kind: "release_regression", severity: "critical",
  title: "Release 3.1.0 regressed — purchase rate <down>", body: "Purchase rate 7.0% & falling", payload: {},
  created_at: NOW.toISOString(), ...o,
})

Deno.test("telegramRequest: Bot API sendMessage with chat_id, HTML text, no preview", () => {
  const r = telegramRequest(TOKEN, "-1001234567890", alert(), "Reels & Co")
  assertEquals(r.url, `https://api.telegram.org/bot${TOKEN}/sendMessage`)
  const body = JSON.parse(r.body)
  assertEquals(Object.keys(body).sort(), ["chat_id", "disable_web_page_preview", "parse_mode", "text"])
  assertEquals(body.chat_id, "-1001234567890")
  assertEquals(body.parse_mode, "HTML")
  assertEquals(body.disable_web_page_preview, true)
  assertStringIncludes(body.text, "<b>Reels &amp; Co · Release 3.1.0 regressed — purchase rate &lt;down&gt;</b>")
  assertStringIncludes(body.text, "Purchase rate 7.0% &amp; falling")
  assertStringIncludes(body.text, '<a href="https://paycraft.mobilebytesensei.com/live">')
})

Deno.test("telegramText: non-funnel kinds link to the inbox; long bodies stay under Telegram's 4096 cap", () => {
  assertStringIncludes(telegramText(alert({ kind: "paid_not_granted" })), "/alerts\">")
  assert(telegramText(alert({ body: "x".repeat(4000) })).length < 4096)
})

// ── Delivery + engine wiring ──────────────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>

/** Just enough of the 211/224 RPC surface: targets with Telegram, a recording ledger, canned rule rows. */
function fakeDb(ruleRows: Record<string, Row[]> = {}) {
  const calls: Array<{ fn: string; args: Row }> = []
  const ledger: Row[] = []
  const recorded: Row[] = []
  return {
    calls, ledger, recorded,
    rpc(fn: string, args: Row) {
      calls.push({ fn, args })
      if (fn === "tenant_alert_channels_decrypt") {
        return Promise.resolve({ data: [{ owner_email: null, app_name: "Reels", email_enabled: false, inbox_enabled: true,
          slack_url: null, webhook_url: null, webhook_secret: null, telegram_bot_token: TOKEN, telegram_chat_id: "-42" }], error: null })
      }
      if (fn === "tenant_alert_record") {
        recorded.push(args)
        return Promise.resolve({ data: crypto.randomUUID(), error: null })
      }
      if (fn === "alert_delivery_record") {
        ledger.push(args)
        return Promise.resolve({ data: [{ status: args.p_ok ? "sent" : "failed", attempts: 1, next_retry_at: null }], error: null })
      }
      if (fn === "alert_deliveries_due") return Promise.resolve({ data: [], error: null })
      return Promise.resolve({ data: ruleRows[fn] ?? [], error: null })
    },
  }
}

const fetchThat = (status: number | "throw", seen: string[] = []): ChannelDeps => ({
  now: () => NOW,
  fetch: ((input: RequestInfo | URL) => {
    seen.push(String(input))
    if (status === "throw") return Promise.reject(new TypeError(`error sending request for url (${String(input)})`))
    return Promise.resolve(new Response(status < 400 ? '{"ok":true}' : '{"ok":false,"description":"Unauthorized"}', { status }))
  }) as typeof fetch,
})

Deno.test("dispatchAlert: a configured Telegram gets the message and a 'telegram' ledger row", async () => {
  const db = fakeDb()
  const seen: string[] = []
  const out = await dispatchAlert(db, alert(), fetchThat(200, seen))
  assertEquals(seen, [`https://api.telegram.org/bot${TOKEN}/sendMessage`])
  const tg = out.find((d) => d.channel === "telegram")!
  assertEquals(tg.ok, true)
  assertEquals(db.ledger.find((r) => r.p_channel === "telegram")!.p_ok, true)
})

Deno.test("dispatchAlert: a Telegram failure is recorded, never thrown, and never leaks the token", async () => {
  for (const status of [401, "throw"] as const) {
    const db = fakeDb()
    const out = await dispatchAlert(db, alert(), fetchThat(status))
    const tg = out.find((d) => d.channel === "telegram")!
    assertEquals(tg.ok, false)
    assert(!JSON.stringify(out).includes("telegram_secret_token"), `token leaked (${status})`)
    assert(!JSON.stringify(db.ledger).includes("telegram_secret_token"), `token stored (${status})`)
    assertEquals(out.find((d) => d.channel === "inbox")!.ok, true, "other channels unaffected")
  }
})

Deno.test("runCritical: evaluates the three 224 rules with the contract parameters and raises what fires", async () => {
  const db = fakeDb({
    analytics_alert_release_regression: [release({ purchase_rate: 0.01 })],
    analytics_alert_sign_in_failing: [{ tenant_id: T, sign_in_fails: 2, sign_in_completes: 0 }], // below 5 → no alert
    analytics_alert_paywall_silent: [{ tenant_id: T, paywall_views: 0, baseline_mean: 9 }],
  })
  const r = await runCritical(db, NOW, fetchThat(500))
  assertEquals(r.errors, [])
  assertEquals(db.recorded.map((a) => a.p_kind).sort(), ["paywall_silent", "release_regression"])
  const args = (fn: string) => db.calls.find((c) => c.fn === fn)!.args
  assertEquals(args("analytics_alert_release_regression").p_min_devices, 30)
  assertEquals(args("analytics_alert_sign_in_failing").p_min_fails, 5)
  assertEquals(args("analytics_alert_sign_in_failing").p_window_minutes, 60)
  assertEquals(args("analytics_alert_paywall_silent").p_min_baseline, 5)
  assertEquals(r.created, 2)
  assert(r.deliveries_failed >= 2, "telegram 500s counted as failed deliveries, run still ok")
})
