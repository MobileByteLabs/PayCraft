// Owner alert channels + per-kind toggles (paycraft-attempt-observability GOAL D8 / AC-15) — shared by the
// Settings card and `/api/alert-channels`.
//
// Storage (migration 211): `tenant_alert_channels` holds email on/off, the Slack URL and the outbound webhook URL +
// HMAC secret (pgcrypto-encrypted, written ONLY through `tenant_alert_channels_save`), inbox on/off. The dashboard
// reads `tenant_alert_channels_status`, which returns booleans — the secrets never come back, not even masked.
// Which KINDS fire is `tenant_alert_prefs` (025 + 211 columns), checked by `tenant_alert_record` for every channel.
//
// The validators mirror the RPC's rules (and its error codes) so a form gets the answer before the round trip;
// the RPC stays the authority.

export const CHANNEL_KINDS = ["email", "slack", "webhook", "inbox"] as const
export type ChannelKind = (typeof CHANNEL_KINDS)[number]

export const ALERT_KINDS = [
  { key: "paid_not_granted", label: "Paid, not granted", severity: "critical", help: "A provider took the money and no access followed within 10 minutes." },
  { key: "webhook_sig_fail", label: "Webhook signature failures", severity: "critical", help: "A provider's webhooks stopped verifying — usually a rotated signing secret." },
  { key: "webhook_proc_fail", label: "Webhook processing failures", severity: "critical", help: "Webhooks arrive but PayCraft could not apply them." },
  { key: "failure_rate_spike", label: "Failure-rate spike", severity: "critical", help: "This hour's failures at one stage are 3× the usual rate (and at least 5)." },
  { key: "abandon_digest", label: "Abandoned checkouts", severity: "digest", help: "Hourly count of buyers who left a checkout." },
  { key: "decline_digest", label: "Declined payments", severity: "digest", help: "Hourly count of payments the provider declined." },
] as const
export type AlertKind = (typeof ALERT_KINDS)[number]["key"]
const KIND_KEYS = new Set<string>(ALERT_KINDS.map((k) => k.key))

export type ChannelStatus = {
  email_enabled: boolean
  slack_configured: boolean
  webhook_configured: boolean
  inbox_enabled: boolean
  updated_at: string | null
}

/** What GET returns. No URL, no secret — `secret` is only ever "set" or "unset". */
export type PublicChannels = {
  email: { enabled: boolean; to: string | null }
  slack: { configured: boolean }
  webhook: { configured: boolean; secret: "set" | "unset" }
  inbox: { enabled: boolean }
  kinds: Record<AlertKind, boolean>
  updated_at: string | null
}

export const isSlackUrl = (s: string) => /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[A-Za-z0-9/_-]{6,}$/.test(s)

export const isHttpsUrl = (s: string) => {
  try {
    const u = new URL(s)
    return u.protocol === "https:" && u.hostname.length > 0
  } catch {
    return false
  }
}

export const validateWebhookSecret = (s: string): "ok" | "too_short" | "too_long" =>
  s.length < 16 ? "too_short" : s.length > 200 ? "too_long" : "ok"

export const defaultKinds = (): Record<AlertKind, boolean> =>
  Object.fromEntries(ALERT_KINDS.map((k) => [k.key, true])) as Record<AlertKind, boolean>

/**
 * Builds the public shape from the status row + prefs row by ALLOWLIST: a field is only ever copied by name, so a
 * caller that passes a row carrying plaintext cannot leak it.
 */
export function toPublicChannels(
  status: ChannelStatus,
  prefs: Partial<Record<string, unknown>> | null,
  ownerEmail: string | null,
): PublicChannels {
  const kinds = defaultKinds()
  for (const k of ALERT_KINDS) if (typeof prefs?.[k.key] === "boolean") kinds[k.key] = prefs[k.key] as boolean
  return {
    email: { enabled: status.email_enabled === true, to: ownerEmail },
    slack: { configured: status.slack_configured === true },
    webhook: { configured: status.webhook_configured === true, secret: status.webhook_configured === true ? "set" : "unset" },
    inbox: { enabled: status.inbox_enabled !== false },
    kinds,
    updated_at: status.updated_at ?? null,
  }
}

export type ChannelsRpcParams = {
  p_email_enabled: boolean | null
  p_slack_url: string | null
  p_webhook_url: string | null
  p_webhook_secret: string | null
  p_inbox_enabled: boolean | null
}
export type ChannelsUpdate =
  | { ok: true; rpc: ChannelsRpcParams; kinds: Partial<Record<AlertKind, boolean>> | null }
  | { ok: false; error: string }

const optString = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null)
const optBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null)

/** The PUT body → the save RPC's params. Absent = keep (NULL), "" = clear — the RPC's own convention. */
export function parseChannelsUpdate(body: Record<string, unknown>, current: ChannelStatus): ChannelsUpdate {
  const slack = optString(body.slack_url)
  const webhookUrl = optString(body.webhook_url)
  const secret = optString(body.webhook_secret)
  const inbox = optBool(body.inbox_enabled)

  if (slack && !isSlackUrl(slack)) return { ok: false, error: "slack_url_invalid" }
  if (webhookUrl && (!isHttpsUrl(webhookUrl) || webhookUrl.length > 2048)) return { ok: false, error: "webhook_url_invalid" }
  if (secret && validateWebhookSecret(secret) !== "ok") return { ok: false, error: "webhook_secret_length" }
  if (webhookUrl && !secret && !current.webhook_configured) return { ok: false, error: "webhook_secret_required" }
  if (secret && !webhookUrl && !current.webhook_configured) return { ok: false, error: "webhook_url_required" }
  if (inbox === false) return { ok: false, error: "inbox_required" }

  let kinds: Partial<Record<AlertKind, boolean>> | null = null
  if (body.kinds !== undefined) {
    if (typeof body.kinds !== "object" || body.kinds === null) return { ok: false, error: "bad_kind" }
    kinds = {}
    for (const [k, v] of Object.entries(body.kinds as Record<string, unknown>)) {
      if (!KIND_KEYS.has(k) || typeof v !== "boolean") return { ok: false, error: "bad_kind" }
      kinds[k as AlertKind] = v
    }
  }
  return {
    ok: true,
    rpc: {
      p_email_enabled: optBool(body.email_enabled),
      p_slack_url: slack,
      p_webhook_url: webhookUrl,
      // Blank never clears the secret (clearing the URL does); it means "keep the stored one".
      p_webhook_secret: secret ? secret : null,
      p_inbox_enabled: inbox,
    },
    kinds,
  }
}

const MESSAGES: Record<string, string> = {
  slack_url_invalid: "Use a Slack incoming-webhook URL (https://hooks.slack.com/services/…).",
  webhook_url_invalid: "The webhook URL must start with https://.",
  webhook_secret_length: "The signing secret must be 16–200 characters.",
  webhook_secret_required: "Add a signing secret — it is required the first time.",
  webhook_url_required: "Add the webhook URL the secret belongs to.",
  inbox_required: "The dashboard inbox is always on — it is the record of every alert.",
  bad_kind: "Unknown alert type.",
  bad_body: "Couldn't read that change — reload and try again.",
  bad_channel: "Unknown channel.",
  forbidden: "Only an admin of this app can change alert channels.",
  channel_not_configured: "Save this channel first, then send a test.",
  test_failed: "The test could not be sent — try again.",
}

export const channelErrorMessage = (code: string) => MESSAGES[code] ?? code

/** The RPC raises its codes as the exception message; anything else is a server error. */
export function rpcErrorCode(message: string): string | null {
  return Object.keys(MESSAGES).find((c) => message.includes(c)) ?? null
}

/**
 * A delivery error can quote the destination (e.g. "error sending request for url (https://hooks.slack.com/…)"),
 * and a Slack incoming-webhook URL IS the credential. Every delivery error shown on the dashboard passes through
 * this, so a URL saved as write-only never comes back on screen.
 */
export function redactUrls(s: string | null): string | null {
  return s === null ? null : s.replace(/https?:\/\/[^\s)'"<>]+/gi, "the channel's URL")
}
