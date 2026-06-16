"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
  Copy,
  CreditCard,
  Eye,
  EyeOff,
  ExternalLink,
  HelpCircle,
  Info,
  Key,
  KeyRound,
  Loader2,
  Lock,
  Sparkles,
  Terminal,
  Webhook,
  Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

type ConnectionStatus = {
  connected: boolean
  mode: "oauth" | "keys" | null
  account_id: string | null
  livemode: boolean
}

type Mode = "oauth" | "manual"

interface KeyPair {
  publishable_key: string
  secret_key: string
  webhook_secret: string
}

export default function StripeConnectPage() {
  const router = useRouter()
  const search = useSearchParams()
  const errParam = search.get("error")
  const connectedParam = search.get("connected")

  const [mode, setMode] = useState<Mode>("oauth")
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [oauthAvailable, setOauthAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(errParam)
  // When the user is already connected, default to the Connected status view
  // instead of the setup tabs. They can opt back into setup via "Update keys".
  const [forceSetup, setForceSetup] = useState(false)
  const reload = () => {
    setStatusLoading(true)
    fetch("/api/providers/stripe/status")
      .then((r) => r.json())
      .then((d) => {
        setStatus(d)
        setStatusLoading(false)
      })
      .catch(() => setStatusLoading(false))
  }

  useEffect(() => {
    // 1. Real connection status.
    fetch("/api/providers/stripe/status")
      .then((r) => r.json())
      .then((d) => {
        setStatus(d)
        setStatusLoading(false)
      })
      .catch(() => setStatusLoading(false))
    // 2. Probe whether OAuth platform credentials are wired server-side.
    fetch("/api/providers/stripe/oauth/start", { method: "HEAD" })
      .then((r) => setOauthAvailable(r.ok || r.status === 405 || r.status === 302))
      .catch(() => setOauthAvailable(false))
  }, [connectedParam])

  // Default to manual mode if OAuth isn't configured server-side.
  useEffect(() => {
    if (oauthAvailable === false) setMode("manual")
  }, [oauthAvailable])

  return (
    <div className="max-w-4xl">
      <div className="mb-8 pt-10">
        <nav className="flex items-center gap-2 text-xs font-medium text-ink-400 mb-2">
          <Link href="/settings" className="hover:text-ink-600 transition-colors">
            Settings
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/providers" className="hover:text-ink-600 transition-colors">
            Payment Providers
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink-900">Stripe</span>
        </nav>
        <div className="flex items-center gap-4">
          <Link
            href="/providers"
            className="w-10 h-10 flex items-center justify-center bg-white border border-ink-200 rounded-xl hover:border-ink-300 hover:shadow-sm transition-all text-ink-600"
          >
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-ink-900 tracking-tight">Stripe</h2>
            {statusLoading ? (
              <Badge tone="default">Checking…</Badge>
            ) : status?.connected ? (
              <Badge tone="success" dot>
                Connected ({status.mode === "oauth" ? "via OAuth" : "via API keys"})
              </Badge>
            ) : (
              <Badge tone="warning">Not connected</Badge>
            )}
          </div>
        </div>
      </div>

      {status?.connected && !forceSetup ? (
        <ConnectedStatusView
          status={status}
          onUpdateKeys={() => {
            setForceSetup(true)
            setMode(status.mode === "oauth" ? "oauth" : "manual")
          }}
          onDisconnected={() => {
            setForceSetup(false)
            reload()
          }}
        />
      ) : (
        <>
          {forceSetup && status?.connected && (
            <div className="mb-4 rounded-lg bg-warning-50 border border-warning-200 px-4 py-2 text-xs text-warning-800 flex items-center justify-between">
              <span>
                You're already connected via{" "}
                <strong>{status.mode === "oauth" ? "OAuth" : "Manual API keys"}</strong>.
                Saving below will overwrite the current credentials.
              </span>
              <button
                onClick={() => setForceSetup(false)}
                className="font-bold underline hover:text-warning-900"
              >
                Cancel
              </button>
            </div>
          )}
          <div className="inline-flex rounded-lg border border-ink-200 bg-ink-50 p-1 mb-6">
            <button
              onClick={() => setMode("oauth")}
              disabled={oauthAvailable === false}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                mode === "oauth"
                  ? "bg-white text-ink-900 shadow-sm border border-ink-200"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <Zap className="w-4 h-4" /> OAuth (recommended)
            </button>
            <button
              onClick={() => setMode("manual")}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-md transition-all ${
                mode === "manual"
                  ? "bg-white text-ink-900 shadow-sm border border-ink-200"
                  : "text-ink-500 hover:text-ink-700"
              }`}
            >
              <KeyRound className="w-4 h-4" /> Manual API keys
            </button>
          </div>

          {error && (
            <div className="mb-6 rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
              <div className="flex items-start gap-2">
                <span className="font-bold flex-shrink-0">Connect failed:</span>
                <span className="font-mono text-[12px] break-words">{error}</span>
              </div>
              {error.startsWith("connect_disabled") && (
                <div className="mt-3 pt-3 border-t border-danger-200/60 text-[12px] text-danger-700">
                  <span className="font-semibold">Stripe Connect is disabled on your platform account.</span>{" "}
                  Open{" "}
                  <a
                    href="https://dashboard.stripe.com/settings/connect/onboarding-options"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold hover:text-danger-900"
                  >
                    dashboard.stripe.com → Settings → Connect
                  </a>{" "}
                  and click "Get started" to enable it (~2 minutes). Then retry.
                  In the meantime you can finish setup using Manual API keys.
                </div>
              )}
            </div>
          )}

          {mode === "oauth" ? (
            <OAuthPanel
              oauthAvailable={oauthAvailable}
              onSwitchToManual={() => setMode("manual")}
            />
          ) : (
            <ManualKeysPanel
              isUpdate={forceSetup && status?.connected === true && status.mode === "keys"}
              onSaved={() => {
                setForceSetup(false)
                reload()
              }}
            />
          )}
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

  // CLI tunnel preference — per-tenant + per-mode. When set, the webhook
  // status card renders a green "STRIPE CLI TUNNEL" badge instead of the
  // misleading "NOT REGISTERED" warning (Stripe Dashboard rejects localhost
  // URLs, so endpoints registered via the CLI never show up in
  // webhookEndpoints.list()). Stored in localStorage so it survives reloads
  // without a schema migration — operator-local config, not tenant config.
  const [cliManaged, setCliManaged] = useState<{ test: boolean; live: boolean }>(
    { test: false, live: false },
  )
  const cliKey = `paycraft.stripe.cli_managed.${status.account_id ?? "unknown"}`
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(cliKey)
      if (raw) setCliManaged(JSON.parse(raw))
    } catch {
      // localStorage unavailable (private mode, SSR, etc.) — fall back to
      // in-memory only. Toggling still works for the session.
    }
  }, [cliKey])
  function toggleCli(mode: "test" | "live", value: boolean) {
    const next = { ...cliManaged, [mode]: value }
    setCliManaged(next)
    try {
      window.localStorage.setItem(cliKey, JSON.stringify(next))
    } catch {}
  }

  async function testWebhook() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch("/api/providers/stripe/test-webhook", { method: "POST" })
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
        `Disconnect Stripe?\n\nThis removes the saved ${
          status.mode === "oauth" ? "OAuth access token" : "API keys"
        }. Existing subscriptions on Stripe continue running — only PayCraft's link to your account is cleared. You can re-connect anytime.`,
      )
    )
      return
    setDisconnecting(true)
    try {
      const route =
        status.mode === "oauth"
          ? "/api/providers/stripe/disconnect" // POST (OAuth deauth path)
          : "/api/providers/stripe/disconnect" // DELETE (manual keys path)
      const method = status.mode === "oauth" ? "POST" : "DELETE"
      const res = await fetch(route, { method })
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
              <h3 className="text-lg font-bold text-ink-900">Stripe is connected</h3>
              <p className="text-sm text-ink-500 mt-1">
                PayCraft can now create products, prices, and payment links on
                your behalf. Webhooks for subscription events route through
                tenant-scoped endpoints.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 mb-6">
            <Row label="Mode">
              <span className="text-sm font-bold text-ink-900">
                {status.mode === "oauth" ? "OAuth Connect" : "Manual API keys"}
              </span>
            </Row>
            <Row label="Account">
              <code className="font-mono text-xs text-ink-700 bg-ink-100 px-2 py-1 rounded break-all">
                {status.account_id ?? "—"}
              </code>
            </Row>
            <Row label="Environment">
              <span className="text-sm font-bold text-ink-900">
                {status.livemode === null
                  ? "Test + Live keys saved"
                  : status.livemode
                    ? "Live"
                    : "Test"}
              </span>
            </Row>
            <Row label="Source">
              <span className="text-sm font-bold text-ink-900">
                {status.mode === "oauth"
                  ? "OAuth Connect flow"
                  : "Pasted via /providers/stripe"}
              </span>
            </Row>
          </div>

          <div className="flex flex-wrap gap-3 pt-4 border-t border-ink-100">
            <Button
              variant="primary"
              size="md"
              onClick={testWebhook}
              disabled={testing}
              leading={
                testing ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Webhook className="w-4 h-4" />
                )
              }
            >
              {testing ? "Probing Stripe…" : "Test webhook health"}
            </Button>
            <Button variant="secondary" size="md" onClick={onUpdateKeys}>
              Update keys
            </Button>
            <Button
              variant="ghost"
              size="md"
              onClick={disconnect}
              disabled={disconnecting}
              className="text-danger-600 hover:bg-danger-50 hover:text-danger-700 ml-auto"
            >
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Webhook test result */}
      {testResult && (
        <Card className="shadow-sm">
          <div className="p-6 border-b border-ink-100">
            <h4 className="text-sm font-bold text-ink-900 flex items-center gap-2">
              <Webhook className="w-4 h-4 text-brand-600" />
              Webhook endpoint status
            </h4>
            <p className="text-xs text-ink-500 mt-1">
              Expected URL: <code className="font-mono text-[11px] bg-ink-100 px-1.5 py-0.5 rounded break-all">{testResult.expected_url}</code>
            </p>
          </div>
          <CardBody className="p-6 space-y-3">
            {(testResult.results ?? []).map((r: any) => {
              const isCli = cliManaged[r.mode as "test" | "live"]
              const effectiveStatus =
                r.status === "no_endpoint" && isCli ? "cli_tunnel" : r.status
              const tone =
                effectiveStatus === "ok" || effectiveStatus === "cli_tunnel"
                  ? "success"
                  : effectiveStatus === "no_endpoint" ||
                      effectiveStatus === "key_missing"
                    ? "warning"
                    : "danger"
              return (
                <div
                  key={r.mode}
                  className={`p-4 rounded-lg border ${
                    tone === "success"
                      ? "bg-success-50 border-success-200"
                      : tone === "warning"
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
                        tone === "success"
                          ? "bg-success-100 text-success-700"
                          : tone === "warning"
                            ? "bg-warning-100 text-warning-800"
                            : "bg-danger-100 text-danger-800"
                      }`}
                    >
                      {effectiveStatus === "ok"
                        ? "REGISTERED ✓"
                        : effectiveStatus === "cli_tunnel"
                          ? "STRIPE CLI TUNNEL ✓"
                          : effectiveStatus === "no_endpoint"
                            ? "NOT REGISTERED"
                            : effectiveStatus === "key_missing"
                              ? "NO KEY"
                              : "ERROR"}
                    </span>
                  </div>
                  {effectiveStatus === "ok" && (
                    <>
                      <p className="text-xs text-success-800 leading-relaxed">
                        Stripe has this endpoint registered with{" "}
                        <strong>{r.enabled_events?.length ?? 0}</strong> event
                        type(s) enabled. Webhooks are flowing.
                      </p>
                      {r.enabled_events && r.enabled_events.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {r.enabled_events.slice(0, 6).map((e: string) => (
                            <span
                              key={e}
                              className="text-[10px] font-mono bg-white border border-success-200 text-success-700 px-1.5 py-0.5 rounded"
                            >
                              {e}
                            </span>
                          ))}
                          {r.enabled_events.length > 6 && (
                            <span className="text-[10px] text-success-700 font-bold">
                              +{r.enabled_events.length - 6} more
                            </span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                  {effectiveStatus === "cli_tunnel" && (
                    <div className="space-y-2">
                      <p className="text-xs text-success-800 leading-relaxed">
                        Marked as managed by the Stripe CLI tunnel —{" "}
                        <code className="font-mono bg-white px-1 rounded">
                          stripe listen --forward-to {testResult.expected_url}
                        </code>
                        . Stripe doesn't expose CLI endpoints via
                        webhookEndpoints.list(), so the auto-detector can't see
                        it. Verify with{" "}
                        <code className="font-mono bg-white px-1 rounded">
                          stripe trigger checkout.session.completed
                        </code>{" "}
                        in a second terminal.
                      </p>
                      <button
                        onClick={() => toggleCli(r.mode, false)}
                        className="text-[11px] font-bold text-success-700 underline hover:text-success-900"
                      >
                        I'm no longer using the CLI tunnel — show registration steps again
                      </button>
                    </div>
                  )}
                  {effectiveStatus === "no_endpoint" && (
                    <NotRegisteredHelp
                      mode={r.mode}
                      expectedUrl={testResult.expected_url}
                      onMarkCli={() => toggleCli(r.mode, true)}
                    />
                  )}
                  {effectiveStatus === "key_missing" && (
                    <p className="text-xs leading-relaxed">{r.message}</p>
                  )}
                  {effectiveStatus !== "ok" &&
                    effectiveStatus !== "no_endpoint" &&
                    effectiveStatus !== "key_missing" &&
                    effectiveStatus !== "cli_tunnel" && (
                      <p className="text-xs leading-relaxed">{r.message}</p>
                    )}
                </div>
              )
            })}
          </CardBody>
        </Card>
      )}
    </div>
  )
}

function NotRegisteredHelp({
  mode,
  expectedUrl,
  onMarkCli,
}: {
  mode: "test" | "live"
  expectedUrl: string
  onMarkCli?: () => void
}) {
  const [copied, setCopied] = useState<"url" | "events" | "cli" | "trigger" | null>(null)
  const events =
    "checkout.session.completed customer.subscription.created customer.subscription.updated customer.subscription.deleted invoice.payment_succeeded invoice.payment_failed"
  const cli = `stripe listen --forward-to ${expectedUrl}`
  const trigger = `stripe trigger checkout.session.completed`
  const isLocal = expectedUrl.includes("localhost") || expectedUrl.includes("127.0.0.1")
  const stripeUrl =
    mode === "test"
      ? "https://dashboard.stripe.com/test/webhooks/create"
      : "https://dashboard.stripe.com/webhooks/create"

  function copy(value: string, key: "url" | "events" | "cli" | "trigger") {
    navigator.clipboard.writeText(value)
    setCopied(key)
    setTimeout(() => setCopied(null), 1500)
  }

  // For localhost in test mode: Stripe CLI is the ONLY working path. Stripe
  // Dashboard refuses to register a localhost URL ("The URL must be publicly
  // accessible"), so leading with the Dashboard CTA misleads the user. Show
  // the CLI flow as the recommended path and demote the Dashboard option.
  if (isLocal && mode === "test") {
    return (
      <div className="mt-3 space-y-3 text-xs">
        <div className="p-3 bg-ink-100 border border-ink-200 rounded-lg">
          <p className="text-ink-700 leading-relaxed">
            <strong className="text-ink-900">
              Stripe Dashboard rejects localhost URLs.
            </strong>{" "}
            For local dev, use Stripe CLI to tunnel test events to your machine
            — no public hostname required, no Dashboard webhook to register.
          </p>
        </div>

        <div className="p-4 bg-ink-900 text-ink-100 rounded-lg space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-brand-300" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-300">
              Recommended — Stripe CLI tunnel (test mode)
            </span>
          </div>

          <div>
            <div className="text-[10px] text-ink-400 mb-1.5">
              1 — Install Stripe CLI{" "}
              <a
                href="https://docs.stripe.com/stripe-cli#install"
                target="_blank"
                rel="noreferrer"
                className="underline text-brand-300 hover:text-brand-200"
              >
                (docs)
              </a>
              . On macOS:
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200">
              brew install stripe/stripe-cli/stripe
            </code>
          </div>

          <div>
            <div className="text-[10px] text-ink-400 mb-1.5">
              2 — Log in (one-time):
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200">
              stripe login
            </code>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-ink-400">
                3 — Start the tunnel (leave running):
              </span>
              <button
                onClick={() => copy(cli, "cli")}
                className="text-[10px] font-bold text-brand-300 hover:text-brand-200"
              >
                {copied === "cli" ? "Copied!" : "Copy"}
              </button>
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200 break-all">
              {cli}
            </code>
            <p className="text-[10px] text-ink-400 mt-1.5 leading-relaxed">
              On startup the CLI prints a webhook signing secret beginning with{" "}
              <code className="bg-ink-950 px-1 rounded text-brand-300">whsec_</code>.
              Open <Link href="/providers/stripe" className="underline text-brand-300">
                Update keys
              </Link>{" "}
              above and paste that into <strong>Test webhook secret</strong>.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] text-ink-400">
                4 — Fire a test event from a SECOND terminal:
              </span>
              <button
                onClick={() => copy(trigger, "trigger")}
                className="text-[10px] font-bold text-brand-300 hover:text-brand-200"
              >
                {copied === "trigger" ? "Copied!" : "Copy"}
              </button>
            </div>
            <code className="block bg-ink-950 px-3 py-2 rounded font-mono text-[10px] text-ink-200">
              {trigger}
            </code>
            <p className="text-[10px] text-ink-400 mt-1.5">
              The first terminal will log "checkout.session.completed → 200 OK"
              when the event reaches your dashboard's webhook handler.
            </p>
          </div>

          {onMarkCli && (
            <div className="pt-2 border-t border-ink-800/60">
              <button
                onClick={onMarkCli}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-bold bg-brand-500 text-white rounded hover:bg-brand-400"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Already running it? Mark this mode as Stripe CLI–managed
              </button>
              <p className="text-[10px] text-ink-500 mt-1.5 text-center">
                Removes the misleading "NOT REGISTERED" badge — Stripe doesn't
                expose CLI endpoints via the list API.
              </p>
            </div>
          )}
        </div>

        <details className="p-3 bg-ink-50 border border-ink-200 rounded-lg">
          <summary className="text-[11px] font-semibold text-ink-600 cursor-pointer">
            Alternative — register a public tunnel URL in Stripe Dashboard
          </summary>
          <div className="mt-3 space-y-2 text-[11px] text-ink-600 leading-relaxed">
            <p>
              If you'd rather use the Dashboard, expose your local Supabase via
              a public tunnel and paste THAT URL instead of the localhost one:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>ngrok</strong> (free):{" "}
                <code className="bg-ink-100 px-1 py-0.5 rounded font-mono text-[10px]">
                  ngrok http 54321
                </code>{" "}
                → paste{" "}
                <code className="bg-ink-100 px-1 py-0.5 rounded font-mono text-[10px]">
                  https://&lt;random&gt;.ngrok-free.app/functions/v1/stripe-webhook/&lt;tenant-id&gt;
                </code>
              </li>
              <li>
                <strong>Cloudflare Tunnel</strong>:{" "}
                <code className="bg-ink-100 px-1 py-0.5 rounded font-mono text-[10px]">
                  cloudflared tunnel --url http://localhost:54321
                </code>
              </li>
            </ul>
            <a
              href={stripeUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-[11px] font-bold bg-ink-900 text-white rounded hover:bg-ink-800"
            >
              <ExternalLink className="w-3 h-3" />
              Open Stripe → Webhooks (test)
            </a>
          </div>
        </details>
      </div>
    )
  }

  // Live mode OR public-hostname deployment: Stripe Dashboard path is what we
  // want. Keep the existing "paste URL + events + open Dashboard" flow.
  return (
    <div className="mt-3 space-y-3 text-xs text-warning-900">
      <p className="leading-relaxed">
        PayCraft has the keys for {mode} mode, but Stripe doesn't yet know where
        to send the events. Add the webhook in{" "}
        {mode === "test" ? "test" : "live"} mode (~30 seconds):
      </p>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider">
            1. Endpoint URL — paste this into Stripe
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
            2. Events to enable
          </span>
          <button
            onClick={() => copy(events, "events")}
            className="text-[10px] font-bold underline hover:text-warning-700"
          >
            {copied === "events" ? "Copied!" : "Copy all"}
          </button>
        </div>
        <code className="block font-mono text-[10px] bg-white border border-warning-300 text-warning-900 px-3 py-2 rounded leading-relaxed break-words">
          checkout.session.completed
          <br />
          customer.subscription.created
          <br />
          customer.subscription.updated
          <br />
          customer.subscription.deleted
          <br />
          invoice.payment_succeeded
          <br />
          invoice.payment_failed
        </code>
      </div>

      <a
        href={stripeUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 transition-all"
      >
        <ExternalLink className="w-3 h-3" />
        Open Stripe Dashboard → Webhooks ({mode})
      </a>

      {isLocal && mode === "live" && (
        <p className="text-[11px] text-warning-700 leading-relaxed">
          ⚠ Live mode on localhost is unusual — Stripe requires a public URL.
          Either deploy the dashboard or expose it via a tunnel (ngrok,
          Cloudflare Tunnel) before saving.
        </p>
      )}

      {onMarkCli && (
        <div className="pt-2 border-t border-warning-200/60">
          <button
            onClick={onMarkCli}
            className="text-[11px] font-bold text-warning-800 underline hover:text-warning-900"
          >
            Using Stripe CLI for this mode? Mark CLI-managed (suppress warning)
          </button>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
        {label}
      </span>
      {children}
    </div>
  )
}

function OAuthPanel({
  oauthAvailable,
  onSwitchToManual,
}: {
  oauthAvailable: boolean | null
  onSwitchToManual: () => void
}) {
  return (
    <Card className="shadow-sm">
      <CardBody className="p-10 text-center flex flex-col items-center justify-center">
        <div className="w-20 h-20 bg-ink-50 rounded-2xl flex items-center justify-center mb-6 border border-ink-100 shadow-sm">
          <CreditCard className="w-9 h-9 text-[#635BFF]" strokeWidth={1.5} />
        </div>
        <h3 className="text-2xl font-bold text-ink-900 mb-2">Connect your Stripe account</h3>
        <p className="text-ink-500 max-w-md mx-auto mb-8 leading-relaxed text-sm">
          PayCraft authorizes via Stripe Connect — about 30 seconds. We'll auto-register
          webhooks and read product / subscription events on your behalf.
        </p>

        {oauthAvailable === false ? (
          <div className="w-full max-w-md rounded-xl bg-warning-50 border border-warning-200 px-5 py-4 text-left">
            <div className="text-sm font-bold text-warning-900 mb-1">
              Stripe Connect platform not configured
            </div>
            <p className="text-xs text-warning-700 leading-relaxed">
              This dashboard needs one-time Stripe Connect platform credentials
              before tenants can OAuth. Configure them via the in-dashboard wizard
              (admin-only) — no env var edits or Node restart required.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <a
                href="/admin/platform-keys"
                className="text-xs font-bold text-warning-900 underline hover:text-warning-700"
              >
                Open platform-keys wizard →
              </a>
              <button
                type="button"
                onClick={onSwitchToManual}
                className="text-xs font-bold text-warning-900 underline hover:text-warning-700"
              >
                Or use manual API keys
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 w-full max-w-sm">
            <Button
              variant="primary"
              size="lg"
              className="w-full justify-center shadow-lg shadow-brand-500/20"
              leading={<CreditCard className="w-4 h-4" strokeWidth={2} />}
              onClick={() => {
                window.location.href = "/api/providers/stripe/oauth/start"
              }}
            >
              Connect with Stripe
            </Button>
            <a
              href="https://stripe.com/docs/connect/standard-accounts"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-ink-500 inline-flex items-center gap-1 hover:text-ink-700"
            >
              <ExternalLink className="w-3 h-3" />
              About Stripe Connect Standard
            </a>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

function ManualKeysPanel({
  onSaved,
  isUpdate = false,
}: {
  onSaved: () => void
  isUpdate?: boolean
}) {
  const [test, setTest] = useState<KeyPair>({
    publishable_key: "",
    secret_key: "",
    webhook_secret: "",
  })
  const [live, setLive] = useState<KeyPair>({
    publishable_key: "",
    secret_key: "",
    webhook_secret: "",
  })
  const [showLive, setShowLive] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [supabaseUrl, setSupabaseUrl] = useState<string>("")
  const [webhookCopied, setWebhookCopied] = useState(false)
  const [cliCopied, setCliCopied] = useState(false)

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => {
        setTenantId(d.tenant_id)
        setSupabaseUrl(d.supabase_url)
      })
      .catch(() => {})
  }, [])

  const webhookUrl =
    tenantId && supabaseUrl
      ? `${supabaseUrl}/functions/v1/stripe-webhook/${tenantId}`
      : ""
  // Local dev URLs aren't reachable by Stripe — surface the Stripe CLI command
  // that forwards a public tunnel into the dashboard's webhook handler.
  const isLocal =
    webhookUrl.includes("localhost") || webhookUrl.includes("127.0.0.1")
  const stripeCliCmd = `stripe listen --forward-to ${webhookUrl || "<tenant-webhook-url>"}`

  async function save() {
    setSaving(true)
    setError(null)
    try {
      // In partial-update mode the backend treats empty fields as "keep
      // existing", so we send fields as-is (empty strings become null on the
      // server). For fresh saves we still echo test→live when live is hidden
      // so the SDK has live slots populated.
      const payload = isUpdate
        ? {
            test_publishable_key: test.publishable_key,
            test_secret_key: test.secret_key,
            test_webhook_secret: test.webhook_secret,
            live_publishable_key: showLive ? live.publishable_key : "",
            live_secret_key: showLive ? live.secret_key : "",
            live_webhook_secret: showLive ? live.webhook_secret : "",
          }
        : {
            test_publishable_key: test.publishable_key,
            test_secret_key: test.secret_key,
            test_webhook_secret: test.webhook_secret,
            live_publishable_key: showLive
              ? live.publishable_key
              : test.publishable_key,
            live_secret_key: showLive ? live.secret_key : test.secret_key,
            live_webhook_secret: showLive
              ? live.webhook_secret
              : test.webhook_secret,
          }
      const res = await fetch("/api/providers/stripe/keys", {
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

  function copyText(value: string, setter: (b: boolean) => void) {
    if (!value) return
    navigator.clipboard.writeText(value)
    setter(true)
    setTimeout(() => setter(false), 1500)
  }

  const testFilled =
    test.publishable_key && test.secret_key && test.webhook_secret
  const liveFilled =
    !showLive ||
    (live.publishable_key && live.secret_key && live.webhook_secret)
  // In update mode: enable Save the moment ANY field has a value (each becomes
  // a partial overwrite; missing fields keep their existing encrypted value).
  // In fresh-save mode: require the full test set before Save enables.
  const anyTouched =
    test.publishable_key ||
    test.secret_key ||
    test.webhook_secret ||
    (showLive &&
      (live.publishable_key || live.secret_key || live.webhook_secret))
  const canSave = isUpdate ? !!anyTouched : testFilled && liveFilled

  return (
    <div className="space-y-6">
      {/* ───── What this is ───── */}
      <div className="p-5 bg-gradient-to-br from-brand-50 to-brand-100/30 border border-brand-200 rounded-xl flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-white border border-brand-200 flex items-center justify-center flex-shrink-0">
          <Info className="w-5 h-5 text-brand-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-brand-900 mb-1">
            Manual API keys — single-tenant mode
          </h3>
          <p className="text-xs text-brand-800/90 leading-relaxed">
            Paste your Stripe API keys directly. PayCraft uses them to create
            products / prices / payment links and to verify incoming webhook
            signatures — identical to what Connect OAuth gives you under the
            hood. Best when you manage one Stripe account, not many. Switch to
            OAuth later by configuring{" "}
            <Link href="/admin/platform-keys" className="font-bold underline">
              platform keys
            </Link>
            .
          </p>
        </div>
      </div>

      {/* ───── Step-by-step ───── */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-4 flex items-center gap-2">
          <Sparkles className="w-3 h-3 text-brand-600" />
          Get your credentials from Stripe
        </h2>
        <ol className="space-y-3">
          <Step number={1} title="Copy your Test API keys">
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              Start with test keys — same API surface, zero risk of real charges
              while you wire things up. Switch to live keys later before launch.
            </p>
            <a
              href="https://dashboard.stripe.com/test/apikeys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 transition-all mb-3"
            >
              Open Stripe → Developers → API keys (test)
              <ExternalLink className="w-3 h-3" />
            </a>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-ink-50 rounded border border-ink-200">
                <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wider mb-1">
                  Publishable key
                </div>
                <code className="font-mono text-xs text-ink-700 break-all">
                  pk_test_51A…
                </code>
              </div>
              <div className="p-3 bg-ink-50 rounded border border-ink-200">
                <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wider mb-1">
                  Secret key
                </div>
                <code className="font-mono text-xs text-ink-700 break-all">
                  sk_test_51A…
                </code>
              </div>
            </div>
          </Step>

          <Step number={2} title="Register a webhook endpoint">
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              Stripe needs to notify PayCraft when subscriptions change. Add
              this exact URL as a webhook endpoint in your Stripe Dashboard:
            </p>
            <div className="flex items-center gap-2 p-3 bg-ink-900 text-ink-100 rounded-lg font-mono text-xs mb-3">
              <code className="flex-1 break-all">
                {webhookUrl || "loading tenant URL…"}
              </code>
              <button
                onClick={() => copyText(webhookUrl, setWebhookCopied)}
                disabled={!webhookUrl}
                className="p-2 hover:bg-ink-800 rounded transition-colors disabled:opacity-40"
                title="Copy"
              >
                {webhookCopied ? (
                  <Check className="w-4 h-4 text-success-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <a
              href="https://dashboard.stripe.com/test/webhooks/create"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 transition-all mb-3"
            >
              Open Stripe → Webhooks → Add endpoint (test)
              <ExternalLink className="w-3 h-3" />
            </a>
            <div className="text-[11px] text-ink-500 leading-relaxed mb-2">
              <strong>Subscribe to these events</strong> (paste in the "Select
              events to listen to" field):
            </div>
            <div className="p-3 bg-ink-50 rounded border border-ink-200 font-mono text-[11px] text-ink-700 leading-relaxed">
              checkout.session.completed
              <br />
              customer.subscription.created
              <br />
              customer.subscription.updated
              <br />
              customer.subscription.deleted
              <br />
              invoice.payment_succeeded
              <br />
              invoice.payment_failed
            </div>

            {isLocal && (
              <div className="mt-3 p-3 bg-warning-50 border border-warning-200 rounded-lg">
                <div className="text-xs font-bold text-warning-900 mb-2 flex items-center gap-2">
                  <Terminal className="w-3 h-3" />
                  Local development — Stripe can't reach localhost
                </div>
                <p className="text-[11px] text-warning-800 leading-relaxed mb-2">
                  Use the Stripe CLI to forward webhooks from a public tunnel to
                  your local Supabase. Install:{" "}
                  <a
                    href="https://stripe.com/docs/stripe-cli"
                    target="_blank"
                    rel="noreferrer"
                    className="underline font-bold"
                  >
                    stripe.com/docs/stripe-cli
                  </a>
                  , then run:
                </p>
                <div className="flex items-center gap-2 p-2 bg-ink-900 text-ink-100 rounded font-mono text-[11px]">
                  <code className="flex-1 break-all">{stripeCliCmd}</code>
                  <button
                    onClick={() => copyText(stripeCliCmd, setCliCopied)}
                    className="p-1.5 hover:bg-ink-800 rounded"
                    title="Copy command"
                  >
                    {cliCopied ? (
                      <Check className="w-3 h-3 text-success-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-warning-700 mt-2">
                  The CLI prints a webhook signing secret on startup (
                  <code className="font-mono">whsec_…</code>) — use that as the
                  test webhook secret below.
                </p>
              </div>
            )}
          </Step>

          <Step number={3} title="Copy the webhook signing secret">
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              After adding the endpoint, Stripe shows a "Signing secret" panel
              on the endpoint's page. Click "Reveal" and copy the value — starts
              with <code className="font-mono bg-ink-100 px-1 py-0.5 rounded text-[11px]">whsec_</code>.
              PayCraft uses it to verify that incoming webhook events actually
              came from Stripe (not from an attacker).
            </p>
            <div className="p-3 bg-ink-50 rounded border border-ink-200">
              <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wider mb-1">
                Webhook signing secret
              </div>
              <code className="font-mono text-xs text-ink-700 break-all">
                whsec_AbCdEf1234567890…
              </code>
            </div>
          </Step>

          <Step number={4} title="Paste everything below and save">
            <p className="text-sm text-ink-600 leading-relaxed">
              PayCraft validates each key against Stripe's API before saving
              (calls <code className="font-mono bg-ink-100 px-1 py-0.5 rounded text-[11px]">balance.retrieve()</code>).
              A bad key triggers a clear error here, not at checkout time.
              Going live later? Toggle "Also configure live keys" — same fields,
              different prefix.
            </p>
          </Step>
        </ol>
      </div>

      {/* ───── Form ───── */}
      <Card className="shadow-sm border-2 border-brand-200">
        <div className="p-8 border-b border-ink-100">
          <h3 className="text-lg font-bold text-ink-900 flex items-center gap-2">
            <Key className="w-5 h-5 text-brand-600" />
            Paste your credentials
          </h3>
          <p className="text-sm text-ink-500 mt-1">
            Stored encrypted at rest with pgcrypto via the
            tenant_providers_save_keys SECURITY DEFINER RPC.
          </p>
        </div>
        <CardBody className="p-8 space-y-8">
          {isUpdate && (
            <div className="p-3 bg-brand-50 border border-brand-200 rounded-lg text-xs text-brand-800 leading-relaxed flex items-start gap-2">
              <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>
                <strong>Partial update mode:</strong> leave any field blank to
                keep the value already saved. Filled fields get re-validated
                with Stripe and overwrite. Useful for swapping just the webhook
                secret after a fresh{" "}
                <code className="font-mono bg-white px-1 py-0.5 rounded">
                  stripe listen
                </code>{" "}
                without re-pasting publishable + secret.
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

          {/* Optional live keys */}
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
                    ? "Tick this only if you want to overwrite live values too. Otherwise live stays as-is."
                    : "Optional — add later from this same page when you're ready to ship. Test keys alone are enough for development."}
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
              Keys validated and saved — redirecting…
            </div>
          )}
        </CardBody>
        <div className="p-6 bg-ink-50/50 rounded-b-xl border-t border-ink-100 flex justify-end items-center gap-3">
          <span className="text-xs text-ink-400 flex items-center gap-1">
            <Lock className="w-3 h-3" /> Validated against Stripe before save
          </span>
          <Button
            variant="primary"
            size="lg"
            onClick={save}
            disabled={!canSave || saving || saved}
          >
            {saving ? (
              <span className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Validating with Stripe…
              </span>
            ) : (
              <span className="flex items-center gap-2">
                Save Stripe keys
                <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </Button>
        </div>
      </Card>

      {/* ───── Troubleshooting ───── */}
      <details className="p-5 bg-ink-50 border border-ink-200 rounded-xl">
        <summary className="cursor-pointer text-sm font-semibold text-ink-700 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-ink-500" />
          Troubleshooting common errors
        </summary>
        <div className="mt-4 space-y-3">
          <Trouble
            symptom="test_secret_key must start with sk_test_"
            fix={
              <>
                You pasted a live key in the test slot (or vice versa). Each
                Stripe key has the mode baked into the prefix —{" "}
                <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">
                  pk_test_
                </code>{" "}
                /{" "}
                <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">
                  sk_test_
                </code>{" "}
                for test;{" "}
                <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">
                  pk_live_
                </code>{" "}
                /{" "}
                <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">
                  sk_live_
                </code>{" "}
                for live.
              </>
            }
          />
          <Trouble
            symptom="test key invalid: Invalid API Key provided"
            fix={
              <>
                The key doesn't authenticate. Re-copy from{" "}
                <a
                  href="https://dashboard.stripe.com/test/apikeys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-bold text-brand-700"
                >
                  dashboard.stripe.com/test/apikeys
                </a>{" "}
                — make sure you didn't accidentally include trailing whitespace.
              </>
            }
          />
          <Trouble
            symptom="Webhook events arrive but PayCraft rejects them"
            fix={
              <>
                The webhook signing secret you saved doesn't match the endpoint
                Stripe is signing with. Re-copy from the Stripe endpoint page
                (Webhooks → your endpoint → Signing secret → Reveal). For local
                dev with Stripe CLI, the secret rotates each time you re-run{" "}
                <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">
                  stripe listen
                </code>{" "}
                — paste the latest one.
              </>
            }
          />
          <Trouble
            symptom="My webhook URL is localhost — Stripe says it's unreachable"
            fix={
              <>
                Use{" "}
                <a
                  href="https://stripe.com/docs/stripe-cli"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-bold text-brand-700"
                >
                  Stripe CLI
                </a>{" "}
                forwarding (see Step 2's yellow callout) or expose your local
                dashboard via ngrok / Cloudflare Tunnel.
              </>
            }
          />
        </div>
      </details>
    </div>
  )
}

function Step({
  number,
  title,
  children,
}: {
  number: number
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="bg-white border border-ink-200 rounded-xl overflow-hidden">
      <div className="p-5 flex gap-4">
        <div className="w-8 h-8 rounded-full bg-brand-50 text-brand-700 border-2 border-brand-300 flex items-center justify-center flex-shrink-0 text-xs font-bold">
          {number}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-ink-900 mb-2">{title}</h3>
          {children}
        </div>
      </div>
    </li>
  )
}

function Trouble({ symptom, fix }: { symptom: string; fix: React.ReactNode }) {
  return (
    <div className="p-3 bg-white border border-ink-200 rounded-lg">
      <div className="text-xs font-bold text-danger-700 mb-1 font-mono">
        {symptom}
      </div>
      <div className="text-xs text-ink-600 leading-relaxed">{fix}</div>
    </div>
  )
}

function KeyPairSection({
  label,
  mode,
  value,
  onChange,
  isUpdate = false,
}: {
  label: string
  mode: "test" | "live"
  value: KeyPair
  onChange: (v: KeyPair) => void
  isUpdate?: boolean
}) {
  const [showSecret, setShowSecret] = useState(false)
  const keepBlank = isUpdate ? "Leave blank to keep current" : null
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-bold text-ink-700">{label}</h4>
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Publishable key
        </label>
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder={keepBlank ?? `pk_${mode}_…`}
          value={value.publishable_key}
          onChange={(e) => onChange({ ...value, publishable_key: e.target.value })}
        />
        {keepBlank && (
          <p className="text-[11px] text-ink-400">
            Currently saved — leave blank to keep, paste a new{" "}
            <span className="font-mono">pk_{mode}_…</span> to swap.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">
          Secret key
        </label>
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 pr-10"
            placeholder={keepBlank ?? `sk_${mode}_…`}
            value={value.secret_key}
            onChange={(e) => onChange({ ...value, secret_key: e.target.value })}
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
          >
            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        {keepBlank && (
          <p className="text-[11px] text-ink-400">
            Encrypted at rest, never shown back. Leave blank to keep, paste a new{" "}
            <span className="font-mono">sk_{mode}_…</span> to swap.
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
          placeholder={keepBlank ?? `whsec_…`}
          value={value.webhook_secret}
          onChange={(e) => onChange({ ...value, webhook_secret: e.target.value })}
        />
        {keepBlank && (
          <p className="text-[11px] text-ink-400">
            Most common reason to update — paste a fresh{" "}
            <span className="font-mono">whsec_…</span> from{" "}
            <code className="font-mono bg-ink-100 px-1 rounded">stripe listen</code>{" "}
            without re-pasting the other fields.
          </p>
        )}
      </div>
    </div>
  )
}
