import {
  ALERT_KINDS,
  CHANNEL_KINDS,
  channelErrorMessage,
  defaultKinds,
  isHttpsUrl,
  isSlackUrl,
  parseChannelsUpdate,
  redactUrls,
  toPublicChannels,
  validateWebhookSecret,
} from "@/lib/alert-channels"

const status = { email_enabled: true, slack_configured: true, webhook_configured: true, inbox_enabled: true, updated_at: "2026-11-24T10:00:00Z" }

describe("validators", () => {
  it("isSlackUrl takes Slack incoming-webhook URLs only", () => {
    expect(isSlackUrl("https://hooks.slack.com/services/T0/B0/XYZ123")).toBe(true)
    expect(isSlackUrl("http://hooks.slack.com/services/T0/B0/XYZ123")).toBe(false)
    expect(isSlackUrl("https://discord.com/api/webhooks/1/abc")).toBe(false)
    expect(isSlackUrl("https://hooks.slack.com.evil.io/services/T0/B0/XYZ")).toBe(false)
  })

  it("isHttpsUrl refuses http and a bare host", () => {
    expect(isHttpsUrl("https://ops.example.com/paycraft")).toBe(true)
    expect(isHttpsUrl("http://ops.example.com/paycraft")).toBe(false)
    expect(isHttpsUrl("ops.example.com")).toBe(false)
  })

  it("validateWebhookSecret holds the RPC's 16–200 bounds", () => {
    expect(validateWebhookSecret("")).toBe("too_short")
    expect(validateWebhookSecret("x".repeat(15))).toBe("too_short")
    expect(validateWebhookSecret("x".repeat(16))).toBe("ok")
    expect(validateWebhookSecret("x".repeat(200))).toBe("ok")
    expect(validateWebhookSecret("x".repeat(201))).toBe("too_long")
  })
})

describe("toPublicChannels — nothing secret ever leaves the server", () => {
  it("copies only the allowlisted, non-secret fields even when handed plaintext", () => {
    const tainted = { ...status, slack_url: "https://hooks.slack.com/services/T0/B0/SECRETSLACK", webhook_url: "https://ops.example.com/x", webhook_secret: "s3cr3t-value-abcd-ef12" }
    const out = toPublicChannels(tainted, { paid_not_granted: false }, "owner@example.com")
    const json = JSON.stringify(out)
    expect(json).not.toContain("s3cr3t-value-abcd-ef12")
    expect(json).not.toContain("SECRETSLACK")
    expect(json).not.toContain("ops.example.com")
    expect(Object.keys(out).sort()).toEqual(["email", "inbox", "kinds", "slack", "updated_at", "webhook"])
    expect(Object.keys(out.webhook).sort()).toEqual(["configured", "secret"])
  })

  it("reports a stored secret as 'set', never its characters", () => {
    expect(toPublicChannels(status, {}, null).webhook).toEqual({ configured: true, secret: "set" })
    expect(toPublicChannels({ ...status, webhook_configured: false }, {}, null).webhook).toEqual({ configured: false, secret: "unset" })
  })

  it("fills unsaved prefs with the database default (every kind on)", () => {
    const out = toPublicChannels(status, { abandon_digest: false }, "o@example.com")
    expect(out.kinds.paid_not_granted).toBe(true)
    expect(out.kinds.abandon_digest).toBe(false)
    expect(out.email).toEqual({ enabled: true, to: "o@example.com" })
    expect(Object.keys(out.kinds)).toEqual([...ALERT_KINDS.map((k) => k.key)])
  })

  it("defaultKinds() is every kind on, and there are four channels", () => {
    expect(Object.values(defaultKinds()).every(Boolean)).toBe(true)
    expect(defaultKinds().paid_not_granted).toBe(true)
    expect([...CHANNEL_KINDS]).toEqual(["email", "slack", "webhook", "inbox"])
  })
})

describe("parseChannelsUpdate — the PUT body → RPC params (NULL keeps, '' clears)", () => {
  it("absent fields keep what is stored", () => {
    const r = parseChannelsUpdate({ email_enabled: false }, status)
    expect(r).toEqual({ ok: true, rpc: { p_email_enabled: false, p_slack_url: null, p_webhook_url: null, p_webhook_secret: null, p_inbox_enabled: null }, kinds: null })
  })

  it("empty string clears a channel", () => {
    const r = parseChannelsUpdate({ slack_url: "", webhook_url: "" }, status)
    expect(r.ok && r.rpc.p_slack_url).toBe("")
    expect(r.ok && r.rpc.p_webhook_url).toBe("")
  })

  it("refuses a non-Slack Slack URL, an http webhook, and a short secret", () => {
    expect(parseChannelsUpdate({ slack_url: "https://example.com/hook" }, status)).toEqual({ ok: false, error: "slack_url_invalid" })
    expect(parseChannelsUpdate({ webhook_url: "http://ops.example.com" }, status)).toEqual({ ok: false, error: "webhook_url_invalid" })
    expect(parseChannelsUpdate({ webhook_secret: "short" }, status)).toEqual({ ok: false, error: "webhook_secret_length" })
  })

  it("a first webhook URL needs its secret; a configured one can be re-pointed without it", () => {
    const fresh = { ...status, webhook_configured: false }
    expect(parseChannelsUpdate({ webhook_url: "https://ops.example.com/x" }, fresh)).toEqual({ ok: false, error: "webhook_secret_required" })
    expect(parseChannelsUpdate({ webhook_url: "https://ops.example.com/x" }, status).ok).toBe(true)
  })

  it("inbox can never be switched off (it is the alert record)", () => {
    expect(parseChannelsUpdate({ inbox_enabled: false }, status)).toEqual({ ok: false, error: "inbox_required" })
  })

  it("kind toggles are booleans for known kinds only", () => {
    const r = parseChannelsUpdate({ kinds: { abandon_digest: false, paid_not_granted: true } }, status)
    expect(r.ok && r.kinds).toEqual({ abandon_digest: false, paid_not_granted: true })
    expect(parseChannelsUpdate({ kinds: { nope: true } }, status)).toEqual({ ok: false, error: "bad_kind" })
    expect(parseChannelsUpdate({ kinds: { abandon_digest: "no" } }, status)).toEqual({ ok: false, error: "bad_kind" })
  })

  it("every error code has a human message", () => {
    for (const code of ["slack_url_invalid", "webhook_url_invalid", "webhook_secret_length", "webhook_secret_required", "webhook_url_required", "inbox_required", "bad_kind", "forbidden"]) {
      expect(channelErrorMessage(code)).not.toBe(code)
    }
  })
})

describe("redactUrls — a channel URL is a credential (a Slack incoming-webhook URL IS the secret)", () => {
  it("replaces every URL in a delivery error, keeping the rest of the message", () => {
    const raw = "error sending request for url (https://hooks.slack.com/services/T0/B0/SECRET): client error (Connect)"
    const out = redactUrls(raw)
    expect(out).not.toContain("hooks.slack.com")
    expect(out).not.toContain("SECRET")
    expect(out).toBe("error sending request for url (the channel's URL): client error (Connect)")
    expect(redactUrls("HTTP 500: internal_error")).toBe("HTTP 500: internal_error")
    expect(redactUrls(null)).toBeNull()
  })
})
