"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import { clsx } from "clsx"
import { Bell, Check, CheckCircle2, Inbox, KeyRound, Loader2, Mail, MessageSquare, Send, Webhook, XCircle } from "lucide-react"
import {
  ALERT_KINDS,
  CHANNEL_KINDS,
  channelErrorMessage,
  isHttpsUrl,
  isSlackUrl,
  validateWebhookSecret,
  type AlertKind,
  type ChannelKind,
  type PublicChannels,
} from "@/lib/alert-channels"

/**
 * Settings ▸ Alert channels (migration 211) — where PayCraft sends owner alerts, and which kinds it sends.
 *
 * Persisted through /api/alert-channels. The Slack URL and the webhook URL + signing secret are encrypted on save
 * and never sent back: a configured channel shows "Connected" / "Secret set", and an empty field means "keep".
 * Each channel has a "Send test" that delivers a real test alert through the same sender real alerts use.
 */

const inputClass =
  "w-full border border-ink-200 rounded-lg text-sm focus:ring-2 focus:ring-brand-600/20 focus:border-brand-600 outline-none px-3 py-2 font-mono transition-all bg-white"
const labelClass = "block text-[11px] font-bold text-ink-500 uppercase tracking-wider mb-1"

const CHANNEL_META: Record<ChannelKind, { label: string; icon: typeof Mail }> = {
  email: { label: "Email", icon: Mail },
  slack: { label: "Slack", icon: MessageSquare },
  webhook: { label: "Webhook", icon: Webhook },
  inbox: { label: "Inbox", icon: Inbox },
}

type TestState = { busy: boolean; result: { ok: boolean; text: string } | null }

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={clsx("relative inline-flex items-center", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <input type="checkbox" className="peer sr-only" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <div className="h-5 w-9 rounded-full bg-ink-200 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-ink-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-brand-600 peer-checked:after:translate-x-full peer-checked:after:border-white" />
    </label>
  )
}

function StatusPill({ on, onText, offText }: { on: boolean; onText: string; offText: string }) {
  return (
    <span className={clsx("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset", on ? "bg-success-50 text-success-700 ring-success-100" : "bg-ink-100 text-ink-500 ring-ink-200")}>
      {on ? onText : offText}
    </span>
  )
}

function TestButton({ channel, enabled, state, onTest }: { channel: ChannelKind; enabled: boolean; state: TestState; onTest: (c: ChannelKind) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {state.result && (
        <span
          role="status"
          data-testid={`alert-test-result-${channel}`}
          className={clsx(
            "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold",
            state.result.ok ? "bg-success-50 text-success-700" : "bg-danger-50 text-danger-700",
          )}
        >
          {state.result.ok ? <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} /> : <XCircle className="h-3 w-3" strokeWidth={2.5} />}
          {state.result.text}
        </span>
      )}
      <button
        type="button"
        disabled={!enabled || state.busy}
        onClick={() => onTest(channel)}
        title={enabled ? `Send a test alert to ${CHANNEL_META[channel].label}` : "Save this channel first"}
        className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-700 hover:bg-ink-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" strokeWidth={2.25} />}
        Send test
      </button>
    </div>
  )
}

function newSecret(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return "whsec_" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")
}

export function AlertChannelsCard() {
  const { tenantId } = useDashboard()
  const queryClient = useQueryClient()
  const queryKey = ["alert-channels", tenantId]
  const channelsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await fetch("/api/alert-channels")
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(channelErrorMessage(body?.error ?? "Couldn't load alert channels."))
      return body as PublicChannels
    },
  })
  const [saved, setSaved] = useState<PublicChannels | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [slackUrl, setSlackUrl] = useState("")
  const [webhookUrl, setWebhookUrl] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const [kinds, setKinds] = useState<Record<AlertKind, boolean> | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [tests, setTests] = useState<Record<ChannelKind, TestState>>(
    () => Object.fromEntries(CHANNEL_KINDS.map((c) => [c, { busy: false, result: null }])) as Record<ChannelKind, TestState>,
  )

  const adopt = useCallback((p: PublicChannels) => {
    setSaved(p)
    setEmailEnabled(p.email.enabled)
    setSlackUrl("")
    setWebhookUrl("")
    setWebhookSecret("")
    setKinds(p.kinds)
  }, [])

  // The form adopts the server copy ONCE (first load), then only after its own saves — a background
  // refetch (focus, realtime) must never wipe what the operator is typing.
  useEffect(() => {
    if (channelsQuery.data && !saved) adopt(channelsQuery.data)
  }, [channelsQuery.data, saved, adopt])

  const dirty = useMemo(() => {
    if (!saved || !kinds) return false
    return (
      emailEnabled !== saved.email.enabled ||
      slackUrl.trim() !== "" ||
      webhookUrl.trim() !== "" ||
      webhookSecret.trim() !== "" ||
      ALERT_KINDS.some((k) => kinds[k.key] !== saved.kinds[k.key])
    )
  }, [saved, kinds, emailEnabled, slackUrl, webhookUrl, webhookSecret])

  // Inline checks mirror the RPC, so a typo is caught before Save.
  const slackError = slackUrl.trim() && !isSlackUrl(slackUrl.trim()) ? channelErrorMessage("slack_url_invalid") : null
  const webhookUrlError = webhookUrl.trim() && !isHttpsUrl(webhookUrl.trim()) ? channelErrorMessage("webhook_url_invalid") : null
  const secretError = webhookSecret.trim() && validateWebhookSecret(webhookSecret.trim()) !== "ok" ? channelErrorMessage("webhook_secret_length") : null

  async function put(body: Record<string, unknown>, done: string) {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch("/api/alert-channels", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) {
        setNote({ ok: false, text: channelErrorMessage(out?.error ?? "Couldn't save — try again.") })
        return
      }
      adopt(out as PublicChannels)
      queryClient.setQueryData(queryKey, out)
      setNote({ ok: true, text: done })
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  function save() {
    if (!saved || !kinds) return
    const body: Record<string, unknown> = { email_enabled: emailEnabled }
    if (slackUrl.trim()) body.slack_url = slackUrl.trim()
    if (webhookUrl.trim()) body.webhook_url = webhookUrl.trim()
    if (webhookSecret.trim()) body.webhook_secret = webhookSecret.trim()
    const changedKinds = Object.fromEntries(ALERT_KINDS.filter((k) => kinds[k.key] !== saved.kinds[k.key]).map((k) => [k.key, kinds[k.key]]))
    if (Object.keys(changedKinds).length) body.kinds = changedKinds
    void put(body, "Saved.")
  }

  async function test(channel: ChannelKind) {
    setTests((t) => ({ ...t, [channel]: { busy: true, result: null } }))
    let result: TestState["result"]
    try {
      const res = await fetch("/api/alert-channels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "test", channel }) })
      const out = await res.json().catch(() => ({}))
      if (!res.ok && !out?.delivery) result = { ok: false, text: channelErrorMessage(out?.error ?? "test_failed") }
      else {
        const d = out.delivery as { ok: boolean; http_status: number | null; error: string | null }
        result = d.ok
          ? { ok: true, text: `Delivered${d.http_status ? ` · HTTP ${d.http_status}` : ""}` }
          : { ok: false, text: `Failed${d.http_status ? ` · HTTP ${d.http_status}` : ""}${d.error ? ` — ${d.error.length > 90 ? `${d.error.slice(0, 89)}…` : d.error}` : ""}` }
      }
    } catch (e) {
      result = { ok: false, text: (e as Error).message }
    }
    setTests((t) => ({ ...t, [channel]: { busy: false, result } }))
  }

  const channelOn: Record<ChannelKind, boolean> = {
    email: emailEnabled && !!saved?.email.to,
    slack: !!saved?.slack.configured,
    webhook: !!saved?.webhook.configured,
    inbox: true,
  }

  return (
    <section id="alert-channels" className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm" data-testid="alert-channels-card">
      <div className="border-b border-ink-100 p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-ink-100 text-ink-600">
            <Bell className="h-4 w-4" strokeWidth={2} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-ink-900">Alert channels</h3>
            <p className="mt-0.5 text-sm text-ink-500">
              Where PayCraft tells you a payment needs attention. URLs and secrets are stored encrypted and never shown again.
            </p>
          </div>
        </div>
      </div>

      {channelsQuery.isError && !saved ? (
        <p role="alert" className="m-6 rounded-lg bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {channelsQuery.error.message}{" "}
          <button type="button" onClick={() => channelsQuery.refetch()} className="font-semibold underline">
            Retry
          </button>
        </p>
      ) : !saved || !kinds ? (
        <div role="status" aria-busy="true" className="flex items-center justify-center gap-2 p-10 text-sm text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading alert channels…
        </div>
      ) : (
        <div className="space-y-4 p-6">
          {/* Email */}
          <div className="space-y-3 rounded-lg border border-ink-100 p-4" data-testid="alert-channel-email">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-ink-400" strokeWidth={2} />
                <p className="text-sm font-bold text-ink-900">Email</p>
                <StatusPill on={emailEnabled} onText="On" offText="Off" />
              </div>
              <Toggle checked={emailEnabled} onChange={setEmailEnabled} label="Email alerts" />
            </div>
            <p className="text-xs text-ink-500">
              Sends to the app owner, <span className="font-mono text-ink-700">{saved.email.to ?? "no owner email on file"}</span>.
            </p>
            <TestButton channel="email" enabled={saved.email.enabled && !!saved.email.to} state={tests.email} onTest={test} />
          </div>

          {/* Slack */}
          <div className="space-y-3 rounded-lg border border-ink-100 p-4" data-testid="alert-channel-slack">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-ink-400" strokeWidth={2} />
                <p className="text-sm font-bold text-ink-900">Slack</p>
                <StatusPill on={saved.slack.configured} onText="Connected" offText="Not set" />
              </div>
              {saved.slack.configured && (
                <button type="button" disabled={busy} onClick={() => put({ slack_url: "" }, "Slack removed.")} className="text-xs font-semibold text-ink-500 hover:text-danger-600 disabled:opacity-60">
                  Remove
                </button>
              )}
            </div>
            <div>
              <label htmlFor="alert-slack-url" className={labelClass}>Slack webhook URL</label>
              <input
                id="alert-slack-url"
                className={clsx(inputClass, slackError && "border-danger-500")}
                value={slackUrl}
                autoComplete="off"
                placeholder={saved.slack.configured ? "Saved — paste a new URL to replace it" : "https://hooks.slack.com/services/…"}
                onChange={(e) => setSlackUrl(e.target.value)}
              />
              {slackError && <p className="mt-1 text-[11px] text-danger-600">{slackError}</p>}
            </div>
            <TestButton channel="slack" enabled={saved.slack.configured} state={tests.slack} onTest={test} />
          </div>

          {/* Outbound webhook */}
          <div className="space-y-3 rounded-lg border border-ink-100 p-4" data-testid="alert-channel-webhook">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-ink-400" strokeWidth={2} />
                <p className="text-sm font-bold text-ink-900">Outbound webhook</p>
                <StatusPill on={saved.webhook.configured} onText="Connected" offText="Not set" />
                {saved.webhook.configured && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-600">
                    <KeyRound className="h-3 w-3" strokeWidth={2.5} /> Secret {saved.webhook.secret}
                  </span>
                )}
              </div>
              {saved.webhook.configured && (
                <button type="button" disabled={busy} onClick={() => put({ webhook_url: "" }, "Webhook removed.")} className="text-xs font-semibold text-ink-500 hover:text-danger-600 disabled:opacity-60">
                  Remove
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="alert-webhook-url" className={labelClass}>Webhook URL</label>
                <input
                  id="alert-webhook-url"
                  className={clsx(inputClass, webhookUrlError && "border-danger-500")}
                  value={webhookUrl}
                  autoComplete="off"
                  placeholder={saved.webhook.configured ? "Saved — paste a new URL to replace it" : "https://ops.example.com/paycraft"}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
                {webhookUrlError && <p className="mt-1 text-[11px] text-danger-600">{webhookUrlError}</p>}
              </div>
              <div>
                <label htmlFor="alert-webhook-secret" className={labelClass}>Signing secret</label>
                <div className="flex gap-2">
                  <input
                    id="alert-webhook-secret"
                    type={webhookSecret.startsWith("whsec_") ? "text" : "password"}
                    className={clsx(inputClass, secretError && "border-danger-500")}
                    value={webhookSecret}
                    autoComplete="off"
                    placeholder={saved.webhook.configured ? "•••••••• set — leave blank to keep" : "16–200 characters"}
                    onChange={(e) => setWebhookSecret(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => setWebhookSecret(newSecret())}
                    className="flex-shrink-0 rounded-lg border border-ink-200 bg-white px-3 text-xs font-semibold text-ink-700 hover:bg-ink-50"
                  >
                    {saved.webhook.configured ? "Rotate" : "Generate"}
                  </button>
                </div>
                {secretError ? (
                  <p className="mt-1 text-[11px] text-danger-600">{secretError}</p>
                ) : webhookSecret.startsWith("whsec_") ? (
                  <p className="mt-1 text-[11px] text-warning-700">Copy this secret into your receiver now — after saving it is never shown again.</p>
                ) : (
                  <p className="mt-1 text-[11px] text-ink-500">Requests carry an X-PayCraft-Signature HMAC-SHA256 of the body.</p>
                )}
              </div>
            </div>
            <TestButton channel="webhook" enabled={saved.webhook.configured} state={tests.webhook} onTest={test} />
          </div>

          {/* Inbox */}
          <div className="space-y-3 rounded-lg border border-ink-100 p-4" data-testid="alert-channel-inbox">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Inbox className="h-4 w-4 text-ink-400" strokeWidth={2} />
                <p className="text-sm font-bold text-ink-900">Dashboard inbox</p>
                <StatusPill on onText="Always on" offText="Always on" />
              </div>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white" aria-label="Dashboard inbox is always on">
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            </div>
            <p className="text-xs text-ink-500">Every alert is kept in Monitor ▸ Alerts, whatever else is configured.</p>
            <TestButton channel="inbox" enabled state={tests.inbox} onTest={test} />
          </div>

          {/* Kinds */}
          <div className="overflow-hidden rounded-lg border border-ink-100">
            <div className="border-b border-ink-100 bg-ink-50 px-4 py-3">
              <p className="text-sm font-bold text-ink-900">What each channel receives</p>
              <p className="mt-0.5 text-[11px] text-ink-500">Turning an alert type off stops it on every channel. A tick means that channel will get it.</p>
            </div>
            <table className="w-full text-sm" aria-label="Alert types by channel">
              <thead className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-4 py-2 text-left">Alert</th>
                  {CHANNEL_KINDS.map((c) => (
                    <th key={c} className="px-2 py-2 text-center">{CHANNEL_META[c].label}</th>
                  ))}
                  <th className="px-4 py-2 text-right">On</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {ALERT_KINDS.map((k) => (
                  <tr key={k.key} className={clsx(!kinds[k.key] && "opacity-60")}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className={clsx("h-1.5 w-1.5 rounded-full", k.severity === "critical" ? "bg-danger-500" : "bg-info-500")} aria-hidden />
                        <span className="font-medium text-ink-900">{k.label}</span>
                        <span className="text-[10px] font-semibold uppercase text-ink-400">{k.severity === "critical" ? "now" : "hourly"}</span>
                      </div>
                      <p className="ml-3.5 text-[11px] text-ink-500">{k.help}</p>
                    </td>
                    {CHANNEL_KINDS.map((c) => {
                      const gets = kinds[k.key] && channelOn[c]
                      return (
                        <td key={c} className="px-2 py-2.5 text-center" aria-label={`${k.label} → ${CHANNEL_META[c].label}: ${gets ? "yes" : "no"}`}>
                          {gets ? <Check className="mx-auto h-4 w-4 text-brand-600" strokeWidth={3} /> : <span className="text-ink-300">—</span>}
                        </td>
                      )
                    })}
                    <td className="px-4 py-2.5 text-right">
                      <Toggle checked={kinds[k.key]} onChange={(v) => setKinds({ ...kinds, [k.key]: v })} label={`${k.label} alerts`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            {note && (
              <span role={note.ok ? "status" : "alert"} className={clsx("mr-auto text-xs font-semibold", note.ok ? "text-success-700" : "text-danger-700")}>
                {note.text}
              </span>
            )}
            <button
              type="button"
              disabled={!dirty || busy}
              onClick={() => saved && adopt(saved)}
              className="rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!dirty || busy || !!slackError || !!webhookUrlError || !!secretError}
              onClick={save}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-brand-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
