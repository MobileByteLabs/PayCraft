// supabase/functions/_shared/alert-channels.ts
//
// The ONE owner-alert sender (paycraft-attempt-observability D8, migration 211), used by attempt-alerts,
// tenant-alerts and attempt-insights:
//
//   email    Resend, through _shared/email.ts, to the tenant's owner_email
//   slack    POST {text} to the tenant's Slack incoming-webhook URL
//   webhook  POST the alert as JSON to the tenant's endpoint, signed:
//              X-PayCraft-Timestamp: <unix seconds>
//              X-PayCraft-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
//              X-PayCraft-Alert-Id:  <alert id>   (receivers de-duplicate retries on it)
//   inbox    the dashboard inbox reads tenant_alerts itself; the ledger row records it was offered there
//
// Every alert is STORED FIRST (tenant_alert_record: 24 h dedupe + the tenant's per-kind toggle), then every
// enabled channel is sent in parallel and each result lands on the alert_deliveries ledger
// (alert_delivery_record: attempts, http_status, error, next_retry_at = now + min(2^attempts, 30) min, at
// most 8 attempts). Channels are independent: a non-2xx, a timeout or a thrown error marks THAT delivery
// failed and never stops another (Promise.allSettled). Destinations are decrypted per dispatch by the
// service-role-only tenant_alert_channels_decrypt, so plaintext URLs and secrets exist only in this process.
//
// The database client is passed in (anything with supabase-js's `rpc`), and so are fetch, the email sender
// and the clock — the edge functions pass the real ones, tests pass fakes.

import { type EmailParams, escapeHtml, type SendResult, sendEmail as resendSendEmail } from "./email.ts"

// deno-lint-ignore no-explicit-any
type Any = any

export type Channel = "email" | "slack" | "webhook" | "inbox"
export const CHANNELS: readonly Channel[] = ["email", "slack", "webhook", "inbox"]

export type AlertSeverity = "critical" | "digest"
export type AlertKind =
  | "paid_not_granted"
  | "webhook_sig_fail"
  | "webhook_proc_fail"
  | "failure_rate_spike"
  | "abandon_digest"
  | "decline_digest"
  | "limit_warn"
  | "limit_hit"
  | "webhook_fail"
  | "sub_expiry"
  | "ai_insight"
  | "channel_test"

/** An alert to store and deliver. */
export interface AlertDraft {
  tenantId: string
  kind: AlertKind
  severity: AlertSeverity
  /** 24 h dedupe key within (tenant, kind). */
  dedupeKey: string
  title: string
  body: string
  payload?: Record<string, unknown>
  /** A hand-made email body; absent = rendered from title + body. */
  bodyHtml?: string | null
  stage?: string | null
  code?: string | null
  correlation?: "exact" | "inferred" | null
  /** When it happened; the deps clock when absent. */
  at?: Date
}

/** A stored tenant_alerts row, as the sender needs it. */
export interface StoredAlert {
  id: string
  tenant_id: string
  kind: string
  severity: AlertSeverity
  title: string
  body: string
  body_html?: string | null
  payload: Record<string, unknown>
  created_at: string
}

export interface DeliveryOutcome {
  alertId: string
  channel: Channel
  ok: boolean
  httpStatus: number | null
  error: string | null
  /** From the ledger after this attempt; null when the ledger write itself failed. */
  attempts: number | null
  nextRetryAt: string | null
}

export interface ChannelDeps {
  fetch?: typeof fetch
  sendEmail?: (p: EmailParams) => Promise<SendResult>
  now?: () => Date
  /** Per-request timeout for Slack / webhook POSTs. */
  timeoutMs?: number
}

interface Targets {
  owner_email: string | null
  email_enabled: boolean
  inbox_enabled: boolean
  slack_url: string | null
  webhook_url: string | null
  webhook_secret: string | null
}

interface SendAttempt {
  ok: boolean
  httpStatus: number | null
  error: string | null
}

const DEFAULT_TIMEOUT_MS = 10_000
/** How old a signed webhook may be before a receiver should refuse it (replay window). */
export const SIGNATURE_TOLERANCE_SECONDS = 300
// env-optional: PAYCRAFT_DASHBOARD_URL — literal default on the same line.
const DASHBOARD_URL = Deno.env.get("PAYCRAFT_DASHBOARD_URL") || "https://paycraft.mobilebytesensei.com"

// ── Signing ─────────────────────────────────────────────────────────────────────────────────────────────

async function hmacKey(secret: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ])
}

/** hex HMAC-SHA256(secret, "<timestampSec>.<body>") — the v1 signature. */
export async function signWebhook(secret: string, timestampSec: number, body: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(`${timestampSec}.${body}`))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("")
}

export function signatureHeader(timestampSec: number, hexSignature: string): string {
  return `t=${timestampSec},v1=${hexSignature}`
}

/**
 * What a receiver runs: the header parses, the timestamp is inside the replay window, and v1 matches the
 * HMAC of the RAW body under the shared secret (constant-time compare).
 */
export async function verifyWebhookSignature(
  secret: string,
  header: string,
  rawBody: string,
  opts: { nowSec?: number; toleranceSec?: number } = {},
): Promise<boolean> {
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=", 2)).filter((kv) => kv.length === 2),
  ) as Record<string, string>
  const ts = Number(parts.t)
  if (!Number.isInteger(ts) || !parts.v1) return false
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > (opts.toleranceSec ?? SIGNATURE_TOLERANCE_SECONDS)) return false
  const expected = await signWebhook(secret, ts, rawBody)
  if (expected.length !== parts.v1.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ parts.v1.charCodeAt(i)
  return diff === 0
}

// ── Rendering ───────────────────────────────────────────────────────────────────────────────────────────

function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function slackText(alert: StoredAlert): string {
  const icon = alert.severity === "critical" ? ":rotating_light:" : ":bar_chart:"
  return `${icon} *${slackEscape(alert.title)}*\n${slackEscape(alert.body)}\n<${DASHBOARD_URL}/alerts|Open PayCraft alerts>`
}

export function emailHtml(alert: StoredAlert): string {
  if (alert.body_html) return alert.body_html
  const accent = alert.severity === "critical" ? "#dc2626" : "#4f46e5"
  const paragraphs = alert.body.split("\n").filter((l) => l.trim() !== "")
    .map((l) => `<p style="margin: 0 0 8px; color: #334155;">${escapeHtml(l)}</p>`).join("")
  return `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: ${accent}; margin: 0 0 16px;">${escapeHtml(alert.title)}</h2>
        ${paragraphs}
        <p style="margin-top: 24px;"><a href="${DASHBOARD_URL}/alerts" style="color: #4f46e5;">Open PayCraft alerts</a></p>
        <p style="color: #94a3b8; font-size: 12px;">You receive this because alerts are on for your PayCraft app. Change channels and alert kinds in Settings.</p>
      </div>`
}

export function webhookBody(alert: StoredAlert): string {
  return JSON.stringify({
    id: alert.id,
    type: "paycraft.alert",
    kind: alert.kind,
    severity: alert.severity,
    tenant_id: alert.tenant_id,
    title: alert.title,
    body: alert.body,
    payload: alert.payload,
    created_at: alert.created_at,
  })
}

// ── Channel senders (each returns, never throws) ────────────────────────────────────────────────────────

async function postJson(deps: ChannelDeps, url: string, body: string, headers: Record<string, string>): Promise<SendAttempt> {
  try {
    const res = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "PayCraft-Alerts/1", ...headers },
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    })
    if (res.ok) {
      await res.body?.cancel()
      return { ok: true, httpStatus: res.status, error: null }
    }
    const text = await res.text().catch(() => "")
    return { ok: false, httpStatus: res.status, error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
  } catch (e) {
    return { ok: false, httpStatus: null, error: (e as Error).message || String(e) }
  }
}

async function sendEmailChannel(deps: ChannelDeps, to: string, alert: StoredAlert): Promise<SendAttempt> {
  try {
    const r = await (deps.sendEmail ?? resendSendEmail)({ to, subject: `PayCraft: ${alert.title}`, html: emailHtml(alert) })
    return { ok: r.ok, httpStatus: null, error: r.ok ? null : (r.error ?? "email not sent") }
  } catch (e) {
    return { ok: false, httpStatus: null, error: (e as Error).message || String(e) }
  }
}

async function sendWebhookChannel(deps: ChannelDeps, url: string, secret: string, alert: StoredAlert, now: Date): Promise<SendAttempt> {
  const body = webhookBody(alert)
  const ts = Math.floor(now.getTime() / 1000)
  const sig = await signWebhook(secret, ts, body)
  return postJson(deps, url, body, {
    "X-PayCraft-Timestamp": String(ts),
    "X-PayCraft-Signature": signatureHeader(ts, sig),
    "X-PayCraft-Alert-Id": alert.id,
  })
}

// ── Ledger + orchestration ──────────────────────────────────────────────────────────────────────────────

async function loadTargets(db: Any, tenantId: string): Promise<Targets> {
  const { data, error } = await db.rpc("tenant_alert_channels_decrypt", { p_tenant_id: tenantId })
  if (error) throw new Error(`alert targets for ${tenantId}: ${error.message}`)
  const row = Array.isArray(data) ? data[0] : data
  if (!row) throw new Error(`alert targets for ${tenantId}: tenant_not_found`)
  return row as Targets
}

/**
 * Strip URLs out of a delivery error before it is stored or returned. A Slack incoming-webhook URL
 * (and many tenant webhook URLs) IS the credential, and fetch errors echo the URL they failed on —
 * so a raw error in `alert_deliveries.error` leaks the secret the channel row keeps encrypted.
 */
export function redactUrls(text: string | null): string | null {
  if (text == null) return null
  return text.replace(/\bhttps?:\/\/[^\s"'<>)]+/gi, "<redacted-url>")
}

async function recordDelivery(db: Any, alertId: string, channel: Channel, attempt: SendAttempt, now: Date): Promise<DeliveryOutcome> {
  const r: SendAttempt = { ...attempt, error: redactUrls(attempt.error) }
  const { data, error } = await db.rpc("alert_delivery_record", {
    p_alert_id: alertId,
    p_channel: channel,
    p_ok: r.ok,
    p_http_status: r.httpStatus,
    p_error: r.error,
    p_now: now.toISOString(),
  })
  const row = Array.isArray(data) ? data[0] : data
  return {
    alertId,
    channel,
    ok: r.ok,
    httpStatus: r.httpStatus,
    error: error ? `${r.error ? r.error + "; " : ""}ledger: ${error.message}` : r.error,
    attempts: row?.attempts ?? null,
    nextRetryAt: row?.next_retry_at ?? null,
  }
}

/**
 * Send one stored alert to every enabled channel of its tenant (or only [only]), in parallel, each result on
 * the ledger. Throws only when the destinations cannot be read (e.g. 'forbidden' for a non-service-role
 * client) — then nothing was sent. A tenant without an owner email gets no email row (nothing to send to).
 */
export async function dispatchAlert(
  db: Any,
  alert: StoredAlert,
  deps: ChannelDeps = {},
  only: readonly Channel[] = CHANNELS,
): Promise<DeliveryOutcome[]> {
  const targets = await loadTargets(db, alert.tenant_id)
  const now = (deps.now ?? (() => new Date()))()
  const wants = (c: Channel) => only.includes(c)
  const tasks: Array<Promise<DeliveryOutcome>> = []
  const order: Channel[] = []
  const add = (c: Channel, p: Promise<DeliveryOutcome>) => {
    order.push(c)
    tasks.push(p)
  }

  if (wants("email") && targets.email_enabled && targets.owner_email) {
    add("email", sendEmailChannel(deps, targets.owner_email, alert).then((r) => recordDelivery(db, alert.id, "email", r, now)))
  }
  if (wants("slack") && targets.slack_url) {
    const url = targets.slack_url
    add(
      "slack",
      postJson(deps, url, JSON.stringify({ text: slackText(alert) }), {}).then((r) => recordDelivery(db, alert.id, "slack", r, now)),
    )
  }
  if (wants("webhook") && targets.webhook_url) {
    const url = targets.webhook_url
    const secret = targets.webhook_secret
    add(
      "webhook",
      (secret
        ? sendWebhookChannel(deps, url, secret, alert, now)
        : Promise.resolve<SendAttempt>({ ok: false, httpStatus: null, error: "webhook_secret_missing" }))
        .then((r) => recordDelivery(db, alert.id, "webhook", r, now)),
    )
  }
  if (wants("inbox") && targets.inbox_enabled) {
    add("inbox", recordDelivery(db, alert.id, "inbox", { ok: true, httpStatus: null, error: null }, now))
  }

  const settled = await Promise.allSettled(tasks)
  return settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : {
      alertId: alert.id,
      channel: order[i],
      ok: false,
      httpStatus: null,
      error: (s.reason as Error)?.message ?? String(s.reason),
      attempts: null,
      nextRetryAt: null,
    }
  )
}

/** Store an alert (24 h dedupe + per-kind toggle). The new id, or null when deduped / turned off. */
export async function recordAlert(db: Any, draft: AlertDraft, now: Date = draft.at ?? new Date()): Promise<string | null> {
  const { data, error } = await db.rpc("tenant_alert_record", {
    p_tenant_id: draft.tenantId,
    p_kind: draft.kind,
    p_severity: draft.severity,
    p_dedupe_key: draft.dedupeKey,
    p_title: draft.title,
    p_body: draft.body,
    p_payload: draft.payload ?? {},
    p_body_html: draft.bodyHtml ?? null,
    p_stage: draft.stage ?? null,
    p_code: draft.code ?? null,
    p_correlation: draft.correlation ?? null,
    p_now: now.toISOString(),
  })
  if (error) throw new Error(`tenant_alert_record ${draft.kind}/${draft.dedupeKey}: ${error.message}`)
  return (Array.isArray(data) ? data[0] : data) ?? null
}

/** Store, then deliver. `alertId: null` = deduped or the tenant turned this kind off (nothing sent). */
export async function deliverAlert(
  db: Any,
  draft: AlertDraft,
  deps: ChannelDeps = {},
): Promise<{ alertId: string | null; deliveries: DeliveryOutcome[] }> {
  const now = draft.at ?? (deps.now ?? (() => new Date()))()
  const id = await recordAlert(db, draft, now)
  if (!id) return { alertId: null, deliveries: [] }
  const stored: StoredAlert = {
    id,
    tenant_id: draft.tenantId,
    kind: draft.kind,
    severity: draft.severity,
    title: draft.title,
    body: draft.body,
    body_html: draft.bodyHtml ?? null,
    payload: draft.payload ?? {},
    created_at: now.toISOString(),
  }
  return { alertId: id, deliveries: await dispatchAlert(db, stored, deps) }
}

/** Re-send every failed delivery whose next_retry_at has come — only the channel that failed. */
export async function retryDueDeliveries(db: Any, deps: ChannelDeps = {}, limit = 200): Promise<DeliveryOutcome[]> {
  const now = (deps.now ?? (() => new Date()))()
  const { data, error } = await db.rpc("alert_deliveries_due", { p_now: now.toISOString(), p_limit: limit })
  if (error) throw new Error(`alert_deliveries_due: ${error.message}`)
  const byAlert = new Map<string, { alert: StoredAlert; channels: Channel[] }>()
  for (const r of (data ?? []) as Any[]) {
    const entry = byAlert.get(r.alert_id) ?? {
      alert: {
        id: r.alert_id,
        tenant_id: r.tenant_id,
        kind: r.kind,
        severity: r.severity,
        title: r.title,
        body: r.body,
        body_html: r.body_html,
        payload: r.payload ?? {},
        created_at: r.created_at,
      },
      channels: [] as Channel[],
    }
    entry.channels.push(r.channel as Channel)
    byAlert.set(r.alert_id, entry)
  }
  const out: DeliveryOutcome[] = []
  for (const { alert, channels } of byAlert.values()) {
    try {
      out.push(...await dispatchAlert(db, alert, deps, channels))
    } catch (e) {
      console.error(`[alert-channels] retry ${alert.id}: ${(e as Error).message}`)
    }
  }
  return out
}
