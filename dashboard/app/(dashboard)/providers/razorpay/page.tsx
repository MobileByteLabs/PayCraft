"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  Info,
  Key,
  KeyRound,
  Loader2,
  Lock,
  Sparkles,
  Terminal,
  Webhook,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

type ConnectionStatus = {
  connected: boolean
  mode: "keys" | null
  test_key_id: string | null
  live_key_id: string | null
  livemode: boolean
  connected_at?: string
  updated_at?: string
}

interface KeyPair {
  key_id: string
  key_secret: string
  webhook_secret: string
}

const EMPTY_KEYS: KeyPair = { key_id: "", key_secret: "", webhook_secret: "" }

/**
 * Razorpay provider setup page.
 *
 * Mirrors the Stripe Manual API keys flow exactly (Stripe page is the
 * parent template):
 *
 *   1. Status probe → if connected, show ConnectedStatusView with test
 *      webhook + Update / Disconnect actions.
 *   2. If not connected (or "Update keys" tapped), render the keys form
 *      with partial-update support and the inline "where to find these"
 *      walkthrough.
 *   3. NotRegisteredHelp surfaces ngrok-tunnel instructions when our
 *      expected URL contains localhost (Razorpay Dashboard refuses non-
 *      HTTPS URLs, same as Stripe).
 */
export default function RazorpayProviderPage() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [forceSetup, setForceSetup] = useState(false)

  async function reload() {
    setStatusLoading(true)
    try {
      const res = await fetch("/api/providers/razorpay/status", { cache: "no-store" })
      const data = await res.json()
      setStatus(data)
    } catch {
      setStatus({ connected: false, mode: null, test_key_id: null, live_key_id: null, livemode: false })
    } finally {
      setStatusLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  return (
    <div>
      <div className="mb-8 pt-6">
        <nav className="flex items-center gap-2 text-xs font-medium text-ink-400 mb-3">
          <Link href="/providers" className="hover:text-ink-600 transition-colors">
            Payment providers
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink-900">Razorpay</span>
        </nav>
        <div className="flex items-center gap-4">
          <Link
            href="/providers"
            className="w-10 h-10 flex items-center justify-center bg-white border border-ink-200 rounded-xl hover:border-ink-300 hover:shadow-sm transition-all text-ink-600"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-ink-900 tracking-tight">Razorpay</h2>
            {statusLoading ? (
              <Badge tone="neutral">Checking…</Badge>
            ) : status?.connected ? (
              <Badge tone="success" dot>
                Connected via API keys
              </Badge>
            ) : (
              <Badge tone="warning">Not connected</Badge>
            )}
          </div>
        </div>
      </div>

      {statusLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-ink-400" />
        </div>
      ) : status?.connected && !forceSetup ? (
        <ConnectedStatusView
          status={status}
          onUpdateKeys={() => setForceSetup(true)}
          onDisconnected={() => {
            setForceSetup(false)
            void reload()
          }}
        />
      ) : (
        <>
          {forceSetup && status?.connected && (
            <div className="mb-4 rounded-lg bg-warning-50 border border-warning-200 px-4 py-2 text-xs text-warning-800 flex items-center justify-between">
              <span>
                You're already connected. Saving below uses partial-update
                mode — leave fields blank to keep existing values.
              </span>
              <button
                onClick={() => setForceSetup(false)}
                className="font-bold underline hover:text-warning-900"
              >
                Cancel
              </button>
            </div>
          )}
          <ManualKeysPanel
            isUpdate={forceSetup && status?.connected === true}
            onSaved={() => {
              setForceSetup(false)
              void reload()
            }}
          />
        </>
      )}
    </div>
  )
}

function ConnectedStatusView({
  status,
  onUpdateKeys,
  onDisconnected,
}: {
  status: ConnectionStatus
  onUpdateKeys: () => void
  onDisconnected: () => void
}) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<any | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  async function testWebhook() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/providers/razorpay/test-webhook", { method: "POST" })
      const data = await res.json()
      setTestResult(data)
    } catch (e: any) {
      setTestResult({ error: e.message })
    } finally {
      setTesting(false)
    }
  }

  async function disconnect() {
    if (
      !confirm(
        "Disconnect Razorpay?\n\nThis removes the saved API keys. Existing Razorpay subscriptions keep running — only PayCraft's link to your account is cleared. You can re-connect at any time.",
      )
    )
      return
    setDisconnecting(true)
    try {
      const res = await fetch("/api/providers/razorpay/disconnect", { method: "DELETE" })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(`Disconnect failed: ${d.error ?? res.statusText}`)
        return
      }
      onDisconnected()
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Connection summary */}
      <Card className="shadow-sm border-2 border-success-200">
        <CardBody className="p-8">
          <div className="flex items-start gap-4 mb-6">
            <div className="w-14 h-14 rounded-2xl bg-success-50 border border-success-200 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-success-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-ink-900">Razorpay is connected</h3>
              <p className="text-sm text-ink-500 mt-1">
                PayCraft can now create Plans + Payment Links + Subscriptions
                on your behalf. Webhook events route through your
                tenant-scoped endpoint.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <Row label="Mode">
              <span className="text-sm font-bold text-ink-900">Manual API keys</span>
            </Row>
            <Row label="Test key">
              {status.test_key_id ? (
                <code className="font-mono text-xs text-ink-700 bg-ink-100 px-2 py-1 rounded">
                  {status.test_key_id}
                </code>
              ) : (
                <span className="text-ink-400 text-xs">—</span>
              )}
            </Row>
            <Row label="Live key">
              {status.live_key_id && status.livemode ? (
                <code className="font-mono text-xs text-ink-700 bg-ink-100 px-2 py-1 rounded">
                  {status.live_key_id}
                </code>
              ) : (
                <span className="text-ink-400 text-xs">Not configured</span>
              )}
            </Row>
            <Row label="Updated">
              <span className="text-xs text-ink-600">
                {status.updated_at
                  ? new Date(status.updated_at).toLocaleDateString()
                  : "—"}
              </span>
            </Row>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="primary"
              size="md"
              onClick={() => void testWebhook()}
              disabled={testing}
              leading={testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Webhook className="w-3.5 h-3.5" />}
            >
              {testing ? "Probing…" : "Test webhook"}
            </Button>
            <Button variant="secondary" size="md" onClick={onUpdateKeys}>
              Update keys
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={() => void disconnect()}
              disabled={disconnecting}
              className="text-danger-500 hover:bg-danger-50 hover:text-danger-600 ml-auto"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {testResult && (
        <Card className="shadow-sm">
          <div className="p-6 border-b border-ink-100">
            <h4 className="text-sm font-bold text-ink-900 flex items-center gap-2">
              <Webhook className="w-4 h-4 text-brand-600" />
              Webhook endpoint status
            </h4>
            <p className="text-xs text-ink-500 mt-1">
              Expected URL:{" "}
              <code className="font-mono text-[11px] bg-ink-100 px-1.5 py-0.5 rounded break-all">
                {testResult.expected_url}
              </code>
            </p>
          </div>
          <CardBody className="p-6 space-y-3">
            {(testResult.results ?? []).map((r: any) => (
              <div
                key={r.mode}
                className={`p-4 rounded-lg border ${
                  r.status === "ok"
                    ? "bg-success-50 border-success-200"
                    : r.status === "no_endpoint" || r.status === "key_missing"
                      ? "bg-warning-50 border-warning-200"
                      : "bg-danger-50 border-danger-200"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-bold uppercase tracking-wider">
                    {r.mode} mode
                  </span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                      r.status === "ok"
                        ? "bg-success-100 text-success-700"
                        : r.status === "no_endpoint" || r.status === "key_missing"
                          ? "bg-warning-100 text-warning-800"
                          : "bg-danger-100 text-danger-800"
                    }`}
                  >
                    {r.status === "ok"
                      ? "REGISTERED ✓"
                      : r.status === "no_endpoint"
                        ? "NOT REGISTERED"
                        : r.status === "key_missing"
                          ? "NO KEY"
                          : "ERROR"}
                  </span>
                </div>
                {r.status === "ok" && (
                  <>
                    <p className="text-xs text-success-800 leading-relaxed">
                      Razorpay has this endpoint registered with{" "}
                      <strong>{r.enabled_events?.length ?? 0}</strong> event
                      type(s) subscribed. Webhooks are flowing.
                    </p>
                    {r.enabled_events && r.enabled_events.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {r.enabled_events.slice(0, 8).map((e: string) => (
                          <span
                            key={e}
                            className="text-[10px] font-mono bg-white border border-success-200 text-success-700 px-1.5 py-0.5 rounded"
                          >
                            {e}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {r.status === "no_endpoint" && (
                  <NotRegisteredHelp mode={r.mode} expectedUrl={testResult.expected_url} />
                )}
                {r.status === "key_missing" && (
                  <p className="text-xs leading-relaxed">{r.message}</p>
                )}
                {r.status === "error" && (
                  <p className="text-xs leading-relaxed">{r.message}</p>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function NotRegisteredHelp({
  mode,
  expectedUrl,
}: {
  mode: "test" | "live"
  expectedUrl: string
}) {
  const [copied, setCopied] = useState<"url" | "events" | "ngrok" | null>(null)
  const events =
    "subscription.activated\nsubscription.charged\nsubscription.cancelled\nsubscription.completed\nsubscription.halted\nsubscription.authenticated"
  const ngrokCmd = `ngrok http 54321`
  const isLocal = expectedUrl.includes("localhost") || expectedUrl.includes("127.0.0.1")
  const razorpayUrl = "https://dashboard.razorpay.com/app/webhooks"

  function copy(value: string, key: "url" | "events" | "ngrok") {
    navigator.clipboard.writeText(value)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  if (isLocal) {
    return (
      <div className="mt-3 space-y-3 text-xs">
        <div className="p-3 bg-ink-100 border border-ink-200 rounded-lg">
          <p className="text-ink-700 leading-relaxed">
            <strong className="text-ink-900">
              Razorpay Dashboard rejects http:// localhost URLs.
            </strong>{" "}
            Expose your local Supabase port via ngrok to get an HTTPS public
            URL, then register THAT URL in Razorpay.
          </p>
        </div>

        <div className="p-4 bg-ink-900 text-ink-100 rounded-lg space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-300" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-300">
              Recommended — ngrok tunnel
            </span>
          </div>

          <div>
            <div className="text-[10px] text-ink-400 mb-1.5">
              1 — Install ngrok{" "}
              <a
                href="https://ngrok.com/download"
                target="_blank"
                rel="noreferrer"
                className="underline text-brand-300 hover:text-brand-200"
              >
                (docs)
              </a>
              . On macOS:
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200">
              brew install ngrok
            </code>
          </div>

          <div>
            <div className="text-[10px] text-ink-400 mb-1.5">
              2 — Sign in (one-time, free tier is enough):
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200">
              ngrok config add-authtoken &lt;your-ngrok-token&gt;
            </code>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-ink-400">
                3 — Start the tunnel (leave running):
              </span>
              <button
                onClick={() => copy(ngrokCmd, "ngrok")}
                className="text-[10px] font-bold text-brand-300 hover:text-brand-200"
              >
                {copied === "ngrok" ? "Copied!" : "Copy"}
              </button>
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200 break-all">
              {ngrokCmd}
            </code>
            <p className="text-[10px] text-ink-400 mt-1.5 leading-relaxed">
              ngrok prints a URL like{" "}
              <code className="bg-ink-950 px-1 rounded text-brand-300">
                https://abcd-1234.ngrok-free.app
              </code>
              . Your webhook URL becomes{" "}
              <code className="bg-ink-950 px-1 rounded text-brand-300">
                https://abcd-1234.ngrok-free.app/functions/v1/razorpay-webhook/&lt;tenant_id&gt;
              </code>
              .
            </p>
          </div>

          <div>
            <div className="text-[10px] text-ink-400 mb-1.5">
              4 — Register that ngrok URL in Razorpay Dashboard → Webhooks
              (test mode):
            </div>
            <a
              href={razorpayUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold bg-brand-500 text-white rounded hover:bg-brand-400"
            >
              <ExternalLink className="w-3 h-3" />
              Open Razorpay Dashboard → Webhooks
            </a>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-ink-400">
                5 — Subscribe to these events (copy + paste into search):
              </span>
              <button
                onClick={() => copy(events, "events")}
                className="text-[10px] font-bold text-brand-300 hover:text-brand-200"
              >
                {copied === "events" ? "Copied!" : "Copy all"}
              </button>
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200 whitespace-pre-line">
              {events}
            </code>
          </div>

          <div className="pt-2 border-t border-ink-800/60 text-[10px] text-ink-500 leading-relaxed">
            <strong className="text-ink-300">Webhook secret:</strong> Razorpay
            asks you to type a random 32+ char string. Use any password
            generator. Paste the SAME string into the form above as the
            <strong> Test webhook secret</strong>. They must match exactly
            for signature verification to pass.
          </div>
        </div>
      </div>
    )
  }

  // Public hostname (production) — straight Dashboard path.
  return (
    <div className="mt-3 space-y-3 text-xs text-warning-900">
      <p className="leading-relaxed">
        Razorpay knows your keys, but the webhook URL isn't registered for{" "}
        {mode} mode. Register it in Razorpay Dashboard (~30 seconds):
      </p>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider">
            1. Endpoint URL — paste into Razorpay
          </span>
          <button
            onClick={() => copy(expectedUrl, "url")}
            className="text-[10px] font-bold underline hover:text-warning-700"
          >
            {copied === "url" ? "Copied!" : "Copy"}
          </button>
        </div>
        <code className="block font-mono text-[10px] bg-ink-900 text-ink-100 px-3 py-2 rounded break-all">
          {expectedUrl}
        </code>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider">
            2. Events to subscribe to
          </span>
          <button
            onClick={() => copy(events, "events")}
            className="text-[10px] font-bold underline hover:text-warning-700"
          >
            {copied === "events" ? "Copied!" : "Copy all"}
          </button>
        </div>
        <code className="block font-mono text-[10px] bg-white border border-warning-300 text-warning-900 px-3 py-2 rounded whitespace-pre-line">
          {events}
        </code>
      </div>

      <a
        href={razorpayUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 transition-all"
      >
        <ExternalLink className="w-3 h-3" />
        Open Razorpay Dashboard → Webhooks ({mode})
      </a>

      <p className="text-[11px] text-warning-700 leading-relaxed">
        <strong>Webhook secret:</strong> set a strong random 32+ char string
        in Razorpay's Secret field, then paste the SAME string into the{" "}
        {mode} webhook secret field above. They must match exactly.
      </p>
    </div>
  )
}

function ManualKeysPanel({
  isUpdate = false,
  onSaved,
}: {
  isUpdate?: boolean
  onSaved: () => void
}) {
  const [test, setTest] = useState<KeyPair>(EMPTY_KEYS)
  const [live, setLive] = useState<KeyPair>(EMPTY_KEYS)
  const [showLive, setShowLive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [supabaseUrl, setSupabaseUrl] = useState<string>("http://localhost:54321")

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/me")
        if (!res.ok) return
        const data = await res.json()
        setTenantId(data.tenant_id)
        if (data.supabase_url) setSupabaseUrl(data.supabase_url)
      } catch {
        // /api/me isn't available — fall back to placeholders.
      }
    })()
  }, [])

  const webhookUrl = tenantId
    ? `${supabaseUrl}/functions/v1/razorpay-webhook/${tenantId}`
    : `${supabaseUrl}/functions/v1/razorpay-webhook/<tenant_id>`

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const payload = isUpdate
        ? {
            test_key_id: test.key_id,
            test_key_secret: test.key_secret,
            test_webhook_secret: test.webhook_secret,
            live_key_id: showLive ? live.key_id : "",
            live_key_secret: showLive ? live.key_secret : "",
            live_webhook_secret: showLive ? live.webhook_secret : "",
          }
        : {
            test_key_id: test.key_id,
            test_key_secret: test.key_secret,
            test_webhook_secret: test.webhook_secret,
            live_key_id: showLive ? live.key_id : test.key_id,
            live_key_secret: showLive ? live.key_secret : test.key_secret,
            live_webhook_secret: showLive ? live.webhook_secret : test.webhook_secret,
          }
      const res = await fetch("/api/providers/razorpay/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      setSaved(true)
      setTimeout(onSaved, 1200)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  const testFilled = test.key_id && test.key_secret && test.webhook_secret
  const liveFilled =
    !showLive || (live.key_id && live.key_secret && live.webhook_secret)
  const anyTouched =
    test.key_id ||
    test.key_secret ||
    test.webhook_secret ||
    (showLive && (live.key_id || live.key_secret || live.webhook_secret))
  const canSave = isUpdate ? !!anyTouched : !!(testFilled && liveFilled)

  return (
    <div className="space-y-6">
      {/* What this is */}
      <div className="p-5 bg-gradient-to-br from-brand-50 to-brand-100/30 border border-brand-200 rounded-xl flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-white border border-brand-200 flex items-center justify-center flex-shrink-0">
          <Info className="w-5 h-5 text-brand-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-brand-900 mb-1">
            Razorpay — Indian PSP for INR (cards, UPI, netbanking, wallets)
          </h3>
          <p className="text-xs text-brand-800/90 leading-relaxed">
            Hosted checkout that handles every popular Indian payment method
            on one screen. Supports UPI Autopay for subscriptions (mandate
            via UPI app). Test mode works from any country without KYC; live
            mode requires Indian business activation.
          </p>
        </div>
      </div>

      <Card className="shadow-sm">
        <div className="p-8 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900">
            {isUpdate ? "Update API keys" : "Connect with API keys"}
          </h3>
          <p className="text-sm text-ink-500 mt-1">
            Stored encrypted at rest via pgcrypto. PayCraft validates each
            key against Razorpay before saving.
          </p>
        </div>
        <CardBody className="p-8 space-y-8">
          {isUpdate && (
            <div className="p-3 bg-brand-50 border border-brand-200 rounded-lg text-xs text-brand-800 leading-relaxed flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Partial update mode:</strong> leave any field blank to
                keep the value already saved. Useful for swapping just the
                webhook secret after registering a new endpoint.
              </span>
            </div>
          )}

          <KeyPairSection
            label="Test keys"
            mode="test"
            value={test}
            onChange={setTest}
            isUpdate={isUpdate}
          />

          <div className="pt-2 border-t border-ink-100">
            <label className="flex items-center gap-3 cursor-pointer mb-4">
              <input
                type="checkbox"
                checked={showLive}
                onChange={(e) => setShowLive(e.target.checked)}
                className="w-4 h-4"
              />
              <div>
                <div className="text-sm font-semibold text-ink-900">
                  {isUpdate ? "Also update live keys" : "Also configure live keys"}
                </div>
                <div className="text-xs text-ink-500">
                  {isUpdate
                    ? "Tick to overwrite live values too. Otherwise live stays as-is."
                    : "Live keys require Razorpay business activation (Indian entity). Skip if you're only testing."}
                </div>
              </div>
            </label>
            {showLive && (
              <KeyPairSection
                label="Live keys"
                mode="live"
                value={live}
                onChange={setLive}
                isUpdate={isUpdate}
              />
            )}
          </div>

          {error && (
            <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-2 text-sm text-success-700 bg-success-50 border border-success-200 px-4 py-3 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
              Razorpay keys validated and saved — redirecting…
            </div>
          )}
        </CardBody>
        <div className="p-8 bg-ink-50/50 rounded-b-xl border-t border-ink-100 flex justify-end">
          <Button
            variant="primary"
            size="lg"
            onClick={() => void save()}
            disabled={!canSave || saving || saved}
          >
            {saving ? "Validating & saving…" : isUpdate ? "Update keys" : "Save Razorpay keys"}
          </Button>
        </div>
      </Card>

      {/* Setup walkthrough */}
      <SetupWalkthrough webhookUrl={webhookUrl} />
    </div>
  )
}

function KeyPairSection({
  label,
  mode,
  value,
  onChange,
  isUpdate,
}: {
  label: string
  mode: "test" | "live"
  value: KeyPair
  onChange: (v: KeyPair) => void
  isUpdate: boolean
}) {
  const [showSecret, setShowSecret] = useState(false)
  const keep = isUpdate ? "Leave blank to keep current" : null
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-bold text-ink-700">{label}</h4>
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Key ID
        </label>
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder={keep ?? `rzp_${mode}_…`}
          value={value.key_id}
          onChange={(e) => onChange({ ...value, key_id: e.target.value })}
        />
        {keep && (
          <p className="text-[11px] text-ink-400">
            Currently saved — leave blank to keep, paste a new{" "}
            <span className="font-mono">rzp_{mode}_…</span> to swap.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Key Secret
        </label>
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 pr-10"
            placeholder={keep ?? "24-char alphanumeric"}
            value={value.key_secret}
            onChange={(e) => onChange({ ...value, key_secret: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {keep && (
          <p className="text-[11px] text-ink-400">
            Encrypted at rest, never shown back. Leave blank to keep, paste a
            new key secret to swap.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Webhook secret
        </label>
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder={keep ?? "Your random 32+ char string"}
          value={value.webhook_secret}
          onChange={(e) => onChange({ ...value, webhook_secret: e.target.value })}
        />
        {keep && (
          <p className="text-[11px] text-ink-400">
            Most common reason to update — paste the new secret you set in
            Razorpay Dashboard. Must match exactly for signature verification.
          </p>
        )}
      </div>
    </div>
  )
}

function SetupWalkthrough({ webhookUrl }: { webhookUrl: string }) {
  const [openStep, setOpenStep] = useState<number | null>(1)
  const [copied, setCopied] = useState<string | null>(null)
  const events =
    "subscription.activated\nsubscription.charged\nsubscription.cancelled\nsubscription.completed\nsubscription.halted\nsubscription.authenticated"

  function copy(value: string, key: string) {
    navigator.clipboard.writeText(value)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest px-1">
        Setup walkthrough — find your keys
      </h4>

      <StepCard
        id={1}
        title="Sign up at Razorpay (free, no KYC for test mode)"
        open={openStep === 1}
        onToggle={() => setOpenStep(openStep === 1 ? null : 1)}
      >
        Open{" "}
        <a
          href="https://dashboard.razorpay.com/signup"
          target="_blank"
          rel="noreferrer"
          className="underline text-brand-600 font-bold inline-flex items-center gap-1"
        >
          dashboard.razorpay.com/signup <ExternalLink className="w-3 h-3" />
        </a>{" "}
        and create an account with any email. Skip the "Activate Account"
        prompt — that's for live mode only. Test mode works immediately and
        from any country.
      </StepCard>

      <StepCard
        id={2}
        title="Generate test API keys"
        open={openStep === 2}
        onToggle={() => setOpenStep(openStep === 2 ? null : 2)}
      >
        Toggle to <strong>Test mode</strong> (top-right of the dashboard).
        Navigate to{" "}
        <a
          href="https://dashboard.razorpay.com/app/keys"
          target="_blank"
          rel="noreferrer"
          className="underline text-brand-600 font-bold inline-flex items-center gap-1"
        >
          Settings → API Keys <ExternalLink className="w-3 h-3" />
        </a>{" "}
        and click <strong>Generate Test Key</strong>. Copy both:
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>
            <strong>Key ID</strong> — starts with{" "}
            <code className="bg-ink-100 px-1 rounded font-mono">rzp_test_</code>
          </li>
          <li>
            <strong>Key Secret</strong> — 24-char alphanumeric (shown only
            once; save it locally)
          </li>
        </ul>
        Paste both into the <strong>Test keys</strong> section above.
      </StepCard>

      <StepCard
        id={3}
        title="Register the webhook URL"
        open={openStep === 3}
        onToggle={() => setOpenStep(openStep === 3 ? null : 3)}
      >
        Navigate to{" "}
        <a
          href="https://dashboard.razorpay.com/app/webhooks"
          target="_blank"
          rel="noreferrer"
          className="underline text-brand-600 font-bold inline-flex items-center gap-1"
        >
          Settings → Webhooks <ExternalLink className="w-3 h-3" />
        </a>{" "}
        and click <strong>Add New Webhook</strong>.
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                Webhook URL
              </span>
              <button
                onClick={() => copy(webhookUrl, "url")}
                className="text-[10px] font-bold text-brand-600 hover:text-brand-700"
              >
                {copied === "url" ? "Copied!" : "Copy"}
              </button>
            </div>
            <code className="block bg-ink-900 text-ink-100 px-3 py-2 rounded font-mono text-[10px] break-all">
              {webhookUrl}
            </code>
            {webhookUrl.includes("localhost") && (
              <p className="text-[11px] text-warning-700 mt-1.5 leading-relaxed flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                Razorpay won't accept localhost. Use ngrok (see step 5) to
                get an HTTPS public URL, then substitute the hostname above.
              </p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                Secret — generate any 32+ char random string
              </span>
            </div>
            <p className="text-[11px] text-ink-600">
              Use a password generator. Paste the SAME string into the{" "}
              <strong>Webhook secret</strong> field above. They must match
              exactly for signature verification.
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-500">
                Active Events — tick these
              </span>
              <button
                onClick={() => copy(events, "events")}
                className="text-[10px] font-bold text-brand-600 hover:text-brand-700"
              >
                {copied === "events" ? "Copied!" : "Copy list"}
              </button>
            </div>
            <code className="block bg-ink-50 border border-ink-200 px-3 py-2 rounded font-mono text-[10px] text-ink-700 whitespace-pre-line">
              {events}
            </code>
            <p className="text-[11px] text-ink-500 mt-1.5 leading-relaxed">
              These are the only events PayCraft processes. Payment events
              can be left unchecked.
            </p>
          </div>
        </div>
      </StepCard>

      <StepCard
        id={4}
        title="Test in Razorpay's sandbox"
        open={openStep === 4}
        onToggle={() => setOpenStep(openStep === 4 ? null : 4)}
      >
        After saving keys here, sync a product at{" "}
        <Link href="/products" className="underline text-brand-600 font-bold">
          /products
        </Link>{" "}
        — Razorpay's Plans get auto-created. Use these test credentials at
        checkout:
        <ul className="list-disc pl-5 mt-2 space-y-1 text-[11px]">
          <li>
            <strong>UPI VPA:</strong>{" "}
            <code className="bg-ink-100 px-1 rounded font-mono">
              success@razorpay
            </code>{" "}
            (auto-approves)
          </li>
          <li>
            <strong>UPI VPA:</strong>{" "}
            <code className="bg-ink-100 px-1 rounded font-mono">
              failure@razorpay
            </code>{" "}
            (auto-rejects)
          </li>
          <li>
            <strong>Card success:</strong>{" "}
            <code className="bg-ink-100 px-1 rounded font-mono">
              4111 1111 1111 1111
            </code>
            , any CVV, any future expiry
          </li>
          <li>
            <strong>Mandate (UPI Autopay):</strong> same{" "}
            <code className="bg-ink-100 px-1 rounded font-mono">
              success@razorpay
            </code>{" "}
            with ICICI bank — auto-authorizes
          </li>
        </ul>
      </StepCard>

      <StepCard
        id={5}
        title="Local dev — expose Supabase via ngrok"
        open={openStep === 5}
        onToggle={() => setOpenStep(openStep === 5 ? null : 5)}
      >
        Razorpay refuses localhost URLs. Run ngrok on a separate terminal
        so Razorpay can reach your Edge Function:
        <pre className="bg-ink-900 text-ink-100 px-3 py-2 rounded font-mono text-[10px] mt-2 overflow-x-auto">
          {`# Install ngrok
brew install ngrok

# Authenticate (free tier — sign in at ngrok.com)
ngrok config add-authtoken <your-token>

# Expose Supabase Edge Functions port
ngrok http 54321`}
        </pre>
        <p className="mt-2 text-[11px] text-ink-600 leading-relaxed">
          ngrok prints a URL like{" "}
          <code className="bg-ink-100 px-1 rounded font-mono">
            https://abcd-1234.ngrok-free.app
          </code>
          . Substitute the hostname into the webhook URL when registering in
          Razorpay (the path{" "}
          <code className="bg-ink-100 px-1 rounded font-mono">
            /functions/v1/razorpay-webhook/&lt;tenant_id&gt;
          </code>{" "}
          stays the same).
        </p>
      </StepCard>

      <StepCard
        id={6}
        title="Going to live mode (later)"
        open={openStep === 6}
        onToggle={() => setOpenStep(openStep === 6 ? null : 6)}
      >
        Razorpay live mode requires an Indian business entity (PAN, GST,
        Indian bank account) and goes through their Activation flow under{" "}
        <strong>Account Settings → Activate Live Mode</strong>. Once approved,
        generate Live API Keys (start with{" "}
        <code className="bg-ink-100 px-1 rounded font-mono">rzp_live_</code>),
        register a separate live webhook (with its own secret), and paste
        them above via the{" "}
        <strong>Also configure live keys</strong> toggle.
      </StepCard>
    </div>
  )
}

function StepCard({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: number
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="bg-white border border-ink-200 rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-ink-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="w-6 h-6 flex items-center justify-center bg-ink-100 text-ink-600 text-[12px] font-bold rounded-full flex-shrink-0">
            {id}
          </span>
          <span className="text-sm font-semibold text-ink-900">{title}</span>
        </div>
        <ChevronRight
          className={`w-4 h-4 text-ink-400 transition-transform flex-shrink-0 ${
            open ? "rotate-90" : ""
          }`}
          strokeWidth={2}
        />
      </button>
      {open && (
        <div className="px-12 pb-5 text-[13px] text-ink-600 leading-relaxed">
          {children}
        </div>
      )}
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
    </div>
  )
}
