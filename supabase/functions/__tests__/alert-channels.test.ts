// Owner alert channels (paycraft-attempt-observability D8, migration 211): the one sender behind attempt-alerts
// and tenant-alerts — Resend email, Slack incoming webhook, HMAC-signed outbound webhook, dashboard inbox.
// The database side (dedupe, backoff arithmetic, decrypt refusal, the webhook-pair CHECK) is proven against
// real Postgres by supabase/tests/211_attempt_alerts_test.sql and tests/e2e/attempt-alerts.e2e.test.ts; this
// suite pins what the sender does with what the database hands it. No request leaves the process: fetch and
// the email sender are injected fakes.
// Run: deno test -A supabase/functions/__tests__/alert-channels.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  type ChannelDeps,
  deliverAlert,
  dispatchAlert,
  retryDueDeliveries,
  signatureHeader,
  type StoredAlert,
  verifyWebhookSignature,
} from "../_shared/alert-channels.ts"

type Row = Record<string, unknown>
const NOW = new Date("2026-11-25T10:00:00.000Z")
const SECRET = "pcwh_unit_secret_0123456789"

interface Targets {
  owner_email: string | null
  email_enabled: boolean
  inbox_enabled: boolean
  slack_url: string | null
  webhook_url: string | null
  webhook_secret: string | null
}

/**
 * The RPC surface of migration 211, in memory. alert_delivery_record follows the migration's rule (first
 * failure 2 min, then min(2^attempts, 30) min, a 'sent' row is final) so the sender's retry path can be
 * exercised end to end; the SQL test proves the migration itself does the same.
 */
class FakeAlertDb {
  calls: Array<{ fn: string; args: Row }> = []
  ledger = new Map<string, { status: string; attempts: number; http_status: number | null; error: string | null; next_retry_at: string | null }>()
  alerts = new Map<string, StoredAlert>()
  private dedupe = new Set<string>()
  constructor(public targets: Targets | null, public targetsError: string | null = null) {}

  rpc(fn: string, args: Row): Promise<{ data: unknown; error: { message: string } | null }> {
    this.calls.push({ fn, args })
    switch (fn) {
      case "tenant_alert_channels_decrypt":
        if (this.targetsError) return Promise.resolve({ data: null, error: { message: this.targetsError } })
        return Promise.resolve({ data: this.targets ? [this.targets] : [], error: null })
      case "tenant_alert_record": {
        const key = `${args.p_tenant_id}|${args.p_kind}|${args.p_dedupe_key}`
        if (this.dedupe.has(key)) return Promise.resolve({ data: null, error: null })
        this.dedupe.add(key)
        const id = crypto.randomUUID()
        this.alerts.set(id, {
          id, tenant_id: String(args.p_tenant_id), kind: String(args.p_kind), severity: args.p_severity as "critical",
          title: String(args.p_title), body: String(args.p_body), body_html: (args.p_body_html as string) ?? null,
          payload: (args.p_payload as Row) ?? {}, created_at: String(args.p_now),
        })
        return Promise.resolve({ data: id, error: null })
      }
      case "alert_delivery_record": {
        const k = `${args.p_alert_id}|${args.p_channel}`
        const prev = this.ledger.get(k)
        if (prev?.status === "sent") return Promise.resolve({ data: [], error: null })
        const attempts = (prev?.attempts ?? 0) + 1
        const now = new Date(String(args.p_now)).getTime()
        const ok = args.p_ok === true
        const row = {
          status: ok ? "sent" : "failed",
          attempts,
          http_status: (args.p_http_status as number) ?? null,
          error: ok ? null : String(args.p_error ?? "delivery failed"),
          next_retry_at: ok || attempts >= 8 ? null : new Date(now + Math.min(2 ** attempts, 30) * 60_000).toISOString(),
        }
        this.ledger.set(k, row)
        return Promise.resolve({ data: [{ status: row.status, attempts, next_retry_at: row.next_retry_at }], error: null })
      }
      case "alert_deliveries_due": {
        const at = new Date(String(args.p_now)).getTime()
        const due = [...this.ledger.entries()]
          .filter(([, r]) => r.status === "failed" && r.next_retry_at && new Date(r.next_retry_at).getTime() <= at)
          .map(([k, r]) => {
            const [alertId, channel] = k.split("|")
            const a = this.alerts.get(alertId)!
            return { alert_id: alertId, channel, attempts: r.attempts, tenant_id: a.tenant_id, kind: a.kind, severity: a.severity,
                     title: a.title, body: a.body, body_html: a.body_html, payload: a.payload, created_at: a.created_at }
          })
        return Promise.resolve({ data: due, error: null })
      }
      default:
        throw new Error(`FakeAlertDb: unexpected rpc ${fn}`)
    }
  }
  delivery(alertId: string, channel: string) {
    return this.ledger.get(`${alertId}|${channel}`)
  }
}

interface Captured { url: string; headers: Headers; body: string }

/** Injected fetch + email sender: per-URL status (or a thrown network error), every request captured. */
function fakes(routes: Record<string, number | "throw">, emailOk = true) {
  const requests: Captured[] = []
  const emails: Array<{ to: string; subject: string; html: string }> = []
  const deps: ChannelDeps = {
    now: () => NOW,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, headers: new Headers(init?.headers), body: String(init?.body ?? "") })
      const route = routes[url]
      if (route === "throw") throw new TypeError("network unreachable")
      return new Response(route === undefined || route < 400 ? "ok" : "upstream broke", { status: route ?? 200 })
    }) as typeof fetch,
    sendEmail: (p) => {
      emails.push({ to: p.to, subject: p.subject, html: p.html })
      return Promise.resolve(emailOk ? { ok: true, id: "re_1" } : { ok: false, error: "HTTP 422: invalid" })
    },
  }
  return { deps, requests, emails }
}

const allOn = (over: Partial<Targets> = {}): Targets => ({
  owner_email: "owner@app.test", email_enabled: true, inbox_enabled: true,
  slack_url: "https://hooks.slack.test/T0/B0/x", webhook_url: "https://hooks.owner.test/paycraft", webhook_secret: SECRET,
  ...over,
})

const alert = (over: Partial<StoredAlert> = {}): StoredAlert => ({
  id: crypto.randomUUID(), tenant_id: "t-1", kind: "paid_not_granted", severity: "critical",
  title: "Paid but not granted: att-1", body: "Stripe reported paid; no entitlement after 10 minutes.",
  body_html: null, payload: { attempt_id: "att-1", provider: "stripe" }, created_at: NOW.toISOString(), ...over,
})

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

Deno.test("HMAC: X-PayCraft-Signature is t=<unix>,v1=HMAC-SHA256(t.body) under the tenant secret, and verifies", async () => {
  const db = new FakeAlertDb(allOn({ slack_url: null }))
  const { deps, requests } = fakes({})
  const a = alert()
  await dispatchAlert(db, a, deps)
  const req = requests.find((r) => r.url === "https://hooks.owner.test/paycraft")!
  const ts = req.headers.get("X-PayCraft-Timestamp")!
  assertEquals(ts, String(Math.floor(NOW.getTime() / 1000)))
  const expected = await hmacHex(SECRET, `${ts}.${req.body}`)
  assertEquals(req.headers.get("X-PayCraft-Signature"), `t=${ts},v1=${expected}`)
  assertEquals(req.headers.get("X-PayCraft-Alert-Id"), a.id)
  const body = JSON.parse(req.body)
  assertEquals([body.type, body.id, body.kind, body.severity, body.payload.attempt_id], ["paycraft.alert", a.id, "paid_not_granted", "critical", "att-1"])

  // The receiver-side verifier: right secret passes; a tampered body, a wrong secret and a replay outside the
  // 5-minute window all fail.
  const nowSec = Number(ts)
  const header = req.headers.get("X-PayCraft-Signature")!
  assert(await verifyWebhookSignature(SECRET, header, req.body, { nowSec }))
  assert(!(await verifyWebhookSignature(SECRET, header, req.body.replace("att-1", "att-2"), { nowSec })))
  assert(!(await verifyWebhookSignature("another-secret-0123456789", header, req.body, { nowSec })))
  assert(!(await verifyWebhookSignature(SECRET, header, req.body, { nowSec: nowSec + 301 })))
  assertEquals(signatureHeader(1700000000, "ab"), "t=1700000000,v1=ab")
})

Deno.test("one failed channel never blocks others — Slack 500 is 'failed' while email, webhook and inbox are 'sent' (Promise.allSettled)", async () => {
  const db = new FakeAlertDb(allOn())
  const { deps, emails } = fakes({ "https://hooks.slack.test/T0/B0/x": 500 })
  const a = alert()
  const out = await dispatchAlert(db, a, deps)
  assertEquals(out.map((o) => o.channel).sort(), ["email", "inbox", "slack", "webhook"])
  const slack = db.delivery(a.id, "slack")!
  assertEquals([slack.status, slack.attempts, slack.http_status], ["failed", 1, 500])
  assertStringIncludes(slack.error!, "HTTP 500")
  assertEquals(slack.next_retry_at, new Date(NOW.getTime() + 2 * 60_000).toISOString())
  assertEquals(db.delivery(a.id, "email")!.status, "sent")
  assertEquals(db.delivery(a.id, "webhook")!.status, "sent")
  assertEquals(db.delivery(a.id, "inbox")!.status, "sent")
  assertEquals(emails.length, 1)
  assertEquals(emails[0].to, "owner@app.test")
  assertStringIncludes(emails[0].subject, "Paid but not granted")
})

Deno.test("a channel that throws (network error) never blocks the others either", async () => {
  const db = new FakeAlertDb(allOn())
  const { deps } = fakes({ "https://hooks.owner.test/paycraft": "throw" })
  const a = alert()
  await dispatchAlert(db, a, deps)
  const wh = db.delivery(a.id, "webhook")!
  assertEquals([wh.status, wh.http_status], ["failed", null])
  assertStringIncludes(wh.error!, "network unreachable")
  for (const c of ["email", "slack", "inbox"]) assertEquals(db.delivery(a.id, c)!.status, "sent", c)
})

Deno.test("a delivery error that echoes the channel URL is stored without it (the Slack URL is the credential)", async () => {
  const db = new FakeAlertDb(allOn({ webhook_url: null, webhook_secret: null }))
  const { deps } = fakes({})
  deps.fetch = (async (input: RequestInfo | URL) => {
    throw new TypeError(`error sending request for url (${String(input)}): connection refused`)
  }) as typeof fetch
  const a = alert()
  await dispatchAlert(db, a, deps)
  const slack = db.delivery(a.id, "slack")!
  assertEquals(slack.status, "failed")
  assertStringIncludes(slack.error!, "connection refused")
  assertStringIncludes(slack.error!, "<redacted-url>")
  assert(!slack.error!.includes("hooks.slack.test"), `URL leaked into ledger: ${slack.error}`)
  assert(!slack.error!.includes("/T0/B0/"), `webhook path leaked into ledger: ${slack.error}`)
})

Deno.test("retry — a second send of a failed channel bumps attempts to 2 and widens next_retry_at; only that channel is re-sent", async () => {
  const db = new FakeAlertDb(allOn({ webhook_url: null, webhook_secret: null }))
  const { deps, requests, emails } = fakes({ "https://hooks.slack.test/T0/B0/x": 503 })
  const a = alert()
  const recorded = await deliverAlert(db, {
    tenantId: a.tenant_id, kind: "paid_not_granted", severity: "critical", dedupeKey: "att-1",
    title: a.title, body: a.body, payload: a.payload, at: NOW,
  }, deps)
  const id = recorded.alertId!
  const first = db.delivery(id, "slack")!
  assertEquals(first.attempts, 1)

  // Nothing is due before next_retry_at.
  assertEquals((await retryDueDeliveries(db, deps)).length, 0)
  const later: ChannelDeps = { ...deps, now: () => new Date(NOW.getTime() + 3 * 60_000) }
  const retried = await retryDueDeliveries(db, later)
  assertEquals(retried.map((r) => r.channel), ["slack"])
  const second = db.delivery(id, "slack")!
  assertEquals(second.attempts, 2)
  // backoff: min(2^2, 30) = 4 minutes after the retry's own clock.
  assertEquals(second.next_retry_at, new Date(NOW.getTime() + 3 * 60_000 + 4 * 60_000).toISOString())
  assertEquals(requests.filter((r) => r.url.startsWith("https://hooks.slack.test")).length, 2)
  assertEquals(emails.length, 1, "email was sent once — the retry never re-sends a delivered channel")
  assertEquals(db.delivery(id, "email")!.attempts, 1)
})

Deno.test("email_enabled=false skips email entirely — no sendEmail call, no alert_deliveries row for channel='email'", async () => {
  const db = new FakeAlertDb(allOn({ email_enabled: false }))
  const { deps, emails } = fakes({})
  const a = alert()
  const out = await dispatchAlert(db, a, deps)
  assertEquals(emails.length, 0)
  assertEquals(db.delivery(a.id, "email"), undefined)
  assertEquals(out.some((o) => o.channel === "email"), false)
})

Deno.test("slack_url NULL from tenant_alert_channels_decrypt means no Slack request and no Slack row; inbox off means no inbox row", async () => {
  const db = new FakeAlertDb(allOn({ slack_url: null, inbox_enabled: false }))
  const { deps, requests } = fakes({})
  const a = alert()
  await dispatchAlert(db, a, deps)
  assertEquals(requests.some((r) => r.url.includes("slack")), false)
  assertEquals(db.delivery(a.id, "slack"), undefined)
  assertEquals(db.delivery(a.id, "inbox"), undefined)
  assertEquals(db.delivery(a.id, "webhook")!.status, "sent")
})

Deno.test("a webhook URL without its secret is never sent unsigned — recorded failed 'webhook_secret_missing'", async () => {
  // The tenant_alert_channels_webhook_pair CHECK makes this state unreachable in the table; the sender still
  // refuses it rather than POSTing an unverifiable body if a caller ever hands it one.
  const db = new FakeAlertDb(allOn({ slack_url: null, webhook_secret: null }))
  const { deps, requests } = fakes({})
  const a = alert()
  await dispatchAlert(db, a, deps)
  assertEquals(requests.length, 0)
  const wh = db.delivery(a.id, "webhook")!
  assertEquals([wh.status, wh.error], ["failed", "webhook_secret_missing"])
})

Deno.test("tenant_alert_channels_decrypt 'forbidden' (a caller that is not the service role) sends nothing and surfaces the refusal", async () => {
  const db = new FakeAlertDb(null, "forbidden")
  const { deps, requests, emails } = fakes({})
  await assertRejects(() => dispatchAlert(db, alert(), deps), Error, "forbidden")
  assertEquals(requests.length + emails.length, 0)
  assertEquals(db.calls.filter((c) => c.fn === "alert_delivery_record").length, 0)
})

Deno.test("deliverAlert stores first; a deduped (or kind-disabled) alert dispatches nothing", async () => {
  const db = new FakeAlertDb(allOn())
  const { deps, requests, emails } = fakes({})
  const draft = {
    tenantId: "t-1", kind: "abandon_digest" as const, severity: "digest" as const, dedupeKey: "hour-2026-11-25T09",
    title: "7 checkouts abandoned", body: "Between 09:00 and 10:00 UTC.", payload: { count: 7 }, at: NOW,
  }
  const first = await deliverAlert(db, draft, deps)
  assert(first.alertId)
  assertEquals(first.deliveries.length, 4)
  const order = db.calls.map((c) => c.fn)
  assert(order.indexOf("tenant_alert_record") < order.indexOf("tenant_alert_channels_decrypt"), "stored before delivered")
  const sentBefore = requests.length + emails.length
  const second = await deliverAlert(db, draft, deps)
  assertEquals(second, { alertId: null, deliveries: [] })
  assertEquals(requests.length + emails.length, sentBefore)
})

Deno.test("Slack text escapes &, < and > and the email body escapes HTML from the alert", async () => {
  const db = new FakeAlertDb(allOn({ webhook_url: null, webhook_secret: null }))
  const { deps, requests, emails } = fakes({})
  await dispatchAlert(db, alert({ title: "<b>x</b> & y", body: "a < b" }), deps)
  const slack = JSON.parse(requests.find((r) => r.url.includes("slack"))!.body)
  assertStringIncludes(slack.text, "&lt;b&gt;x&lt;/b&gt; &amp; y")
  assertStringIncludes(slack.text, "a &lt; b")
  assertStringIncludes(emails[0].html, "&lt;b&gt;x&lt;/b&gt; &amp; y")
  assertEquals(emails[0].html.includes("<b>x</b>"), false)
})
