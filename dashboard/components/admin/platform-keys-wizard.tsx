"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  HelpCircle,
  Info,
  Key,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react"

type SlotState = {
  key: string
  has_value: boolean
  updated_at: string | null
}

export function PlatformKeysWizard() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<SlotState[]>([])
  const [clientId, setClientId] = useState("")
  const [secretKey, setSecretKey] = useState("")
  const [showSecret, setShowSecret] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, string>>({})
  const [redirectCopied, setRedirectCopied] = useState(false)

  const redirectUri =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/providers/stripe/oauth/callback`
      : "/api/providers/stripe/oauth/callback"

  useEffect(() => {
    fetch("/api/admin/platform-keys")
      .then((r) => r.json())
      .then((d) => {
        setSlots(d.slots ?? [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const slotMap = Object.fromEntries(slots.map((s) => [s.key, s])) as Record<string, SlotState>
  const allConfigured =
    slotMap.stripe_connect_client_id?.has_value &&
    slotMap.stripe_platform_secret_key?.has_value

  async function save() {
    setSaving(true)
    setError(null)
    setDetails({})
    try {
      const body: Record<string, string> = {}
      if (clientId.trim()) body.stripe_connect_client_id = clientId.trim()
      if (secretKey.trim()) body.stripe_platform_secret_key = secretKey.trim()
      if (!Object.keys(body).length) {
        setError("Enter at least one value to save.")
        setSaving(false)
        return
      }
      const res = await fetch("/api/admin/platform-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Save failed")
        setDetails(data.details ?? {})
        return
      }
      setSaved(true)
      const r2 = await fetch("/api/admin/platform-keys")
      const d2 = await r2.json()
      setSlots(d2.slots ?? [])
      setClientId("")
      setSecretKey("")
      setTimeout(() => router.push("/providers/stripe"), 1500)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  function copyRedirect() {
    navigator.clipboard.writeText(redirectUri)
    setRedirectCopied(true)
    setTimeout(() => setRedirectCopied(false), 1500)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-6 h-6 text-ink-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-4xl pt-10 pb-20">
      {/* ───── Hero ───── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-brand-600" />
          </div>
          <h1 className="text-2xl font-bold text-ink-900">Platform keys</h1>
          {allConfigured && (
            <span className="px-2 py-0.5 rounded-full bg-success-50 border border-success-200 text-[11px] font-bold text-success-700 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> CONFIGURED
            </span>
          )}
        </div>
        <p className="text-sm text-ink-500 max-w-2xl">
          One-time setup for this PayCraft instance. After you save valid Stripe Connect
          credentials, every tenant who clicks "Connect with Stripe" in Providers flows
          through OAuth automatically — no per-tenant configuration needed.
        </p>
      </div>

      {/* ───── What is Stripe Connect? ───── */}
      <div className="mb-8 p-5 bg-gradient-to-br from-brand-50 to-brand-100/30 border border-brand-200 rounded-xl flex items-start gap-4">
        <div className="w-10 h-10 rounded-lg bg-white border border-brand-200 flex items-center justify-center flex-shrink-0">
          <Info className="w-5 h-5 text-brand-600" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-brand-900 mb-1">
            What is Stripe Connect?
          </h3>
          <p className="text-xs text-brand-800/90 leading-relaxed">
            Stripe Connect lets PayCraft (as the "platform") create checkout flows on
            behalf of your tenants. Each tenant authorizes PayCraft once via OAuth, and
            PayCraft can then create products / prices / payment links / webhooks in their
            Stripe account. The credentials below are PayCraft's platform identity — they
            stay constant; every tenant uses them implicitly when they click Connect.
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <a
              href="https://stripe.com/docs/connect/standard-accounts"
              target="_blank"
              rel="noreferrer"
              className="text-xs font-bold text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
            >
              Stripe Connect Standard docs <ExternalLink className="w-3 h-3" />
            </a>
            <Link
              href="/providers/stripe"
              className="text-xs font-bold text-brand-700 hover:text-brand-900 inline-flex items-center gap-1"
            >
              Don't need OAuth? Use Manual API keys →
            </Link>
          </div>
        </div>
      </div>

      {/* ───── Step-by-step guide ───── */}
      <div className="mb-8">
        <h2 className="text-xs font-bold uppercase tracking-wider text-ink-500 mb-4 flex items-center gap-2">
          <Sparkles className="w-3 h-3 text-brand-600" />
          Get your credentials from Stripe
        </h2>

        <ol className="space-y-3">
          <Step
            number={1}
            title="Enable Stripe Connect on your account"
            done={false}
          >
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              If you've never used Connect, you need to activate it first. Standard
              accounts are approved instantly — no waiting.
            </p>
            <a
              href="https://dashboard.stripe.com/settings/connect/onboarding-options"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 transition-all"
            >
              Open Stripe → Settings → Connect
              <ExternalLink className="w-3 h-3" />
            </a>
            <div className="mt-3 p-3 bg-warning-50 border border-warning-200 rounded-lg text-[11px] text-warning-800 leading-relaxed flex gap-2">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>
                If you see "Get started" or "Activate" — click it. Pick{" "}
                <strong>Standard accounts</strong> as the integration type unless you
                have a specific reason to use Express or Custom.
              </span>
            </div>
          </Step>

          <Step
            number={2}
            title="Add this redirect URI to your Connect platform"
            done={false}
          >
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              On the same Connect settings page, under{" "}
              <strong>Integration → Redirects</strong>, paste this exact URL:
            </p>
            <div className="flex items-center gap-2 p-3 bg-ink-900 text-ink-100 rounded-lg font-mono text-xs">
              <code className="flex-1 break-all">{redirectUri}</code>
              <button
                onClick={copyRedirect}
                className="p-2 hover:bg-ink-800 rounded transition-colors"
                title="Copy"
              >
                {redirectCopied ? (
                  <Check className="w-4 h-4 text-success-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <p className="text-[11px] text-ink-400 mt-2">
              Stripe needs this exact URL or the OAuth roundtrip fails with
              "redirect_uri_mismatch". For production, repeat this step with your
              production dashboard's URL.
            </p>
          </Step>

          <Step
            number={3}
            title="Copy your Connect Client ID"
            done={slotMap.stripe_connect_client_id?.has_value}
          >
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              Still on the Connect settings page, look for{" "}
              <strong>Integration → Client ID</strong>. You'll see two values: test
              mode and live mode. Both start with{" "}
              <code className="font-mono bg-ink-100 px-1.5 py-0.5 rounded text-[11px]">
                ca_
              </code>
              .
            </p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="p-3 bg-ink-50 rounded border border-ink-200">
                <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wider mb-1">
                  Example (test)
                </div>
                <code className="font-mono text-xs text-ink-700 break-all">
                  ca_AbCdEfGh1234…test
                </code>
              </div>
              <div className="p-3 bg-ink-50 rounded border border-ink-200">
                <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wider mb-1">
                  Example (live)
                </div>
                <code className="font-mono text-xs text-ink-700 break-all">
                  ca_AbCdEfGh1234…live
                </code>
              </div>
            </div>
            <p className="text-[11px] text-ink-400">
              Use the test client ID while developing — your tenants will only see test
              Stripe accounts in checkout. Swap to the live client ID before launch.
            </p>
          </Step>

          <Step
            number={4}
            title="Copy your Platform Secret Key"
            done={slotMap.stripe_platform_secret_key?.has_value}
          >
            <p className="text-sm text-ink-600 leading-relaxed mb-3">
              Open a new tab and grab your Stripe Secret key. PayCraft uses it to call
              Stripe's OAuth token exchange (a server-to-server call — it never reaches
              the tenant).
            </p>
            <a
              href="https://dashboard.stripe.com/apikeys"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 transition-all mb-3"
            >
              Open Stripe → Developers → API keys
              <ExternalLink className="w-3 h-3" />
            </a>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="p-3 bg-ink-50 rounded border border-ink-200">
                <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wider mb-1">
                  Test mode
                </div>
                <code className="font-mono text-xs text-ink-700 break-all">
                  sk_test_51A…
                </code>
              </div>
              <div className="p-3 bg-ink-50 rounded border border-ink-200">
                <div className="text-[10px] font-bold text-ink-500 uppercase tracking-wider mb-1">
                  Live mode
                </div>
                <code className="font-mono text-xs text-ink-700 break-all">
                  sk_live_51A…
                </code>
              </div>
            </div>
            <div className="p-3 bg-danger-50 border border-danger-200 rounded-lg text-[11px] text-danger-800 leading-relaxed flex gap-2">
              <Lock className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span>
                The Secret key is sensitive. PayCraft encrypts it at rest with pgcrypto
                and only the SECURITY DEFINER RPC can decrypt — even other admins of
                this instance can't read it back. Never share it in chat / email / git.
              </span>
            </div>
          </Step>
        </ol>
      </div>

      {/* ───── Form ───── */}
      <div className="bg-white border-2 border-brand-200 rounded-xl p-8 shadow-sm">
        <h2 className="text-sm font-bold text-ink-900 mb-1 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-brand-600" />
          Paste your credentials
        </h2>
        <p className="text-xs text-ink-500 mb-6">
          PayCraft validates both values against Stripe's API before saving. A bad
          secret triggers a clear error here, not at OAuth time.
        </p>

        <div className="space-y-6">
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block flex items-center gap-2">
              <Key className="w-3 h-3" />
              Stripe Connect Client ID
              {slotMap.stripe_connect_client_id?.has_value && (
                <span className="text-[10px] text-success-700 font-bold ml-1 inline-flex items-center gap-0.5">
                  <CheckCircle2 className="w-3 h-3" /> CURRENTLY SET
                </span>
              )}
            </label>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={
                slotMap.stripe_connect_client_id?.has_value
                  ? "Leave blank to keep current value"
                  : "ca_…"
              }
              className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
            />
            {details.stripe_connect_client_id && (
              <p className="text-xs text-danger-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {details.stripe_connect_client_id}
              </p>
            )}
            <p className="text-[11px] text-ink-400">
              From Step 3 above. Starts with{" "}
              <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">ca_</code>.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block flex items-center gap-2">
              <Key className="w-3 h-3" />
              Stripe Platform Secret Key
              {slotMap.stripe_platform_secret_key?.has_value && (
                <span className="text-[10px] text-success-700 font-bold ml-1 inline-flex items-center gap-0.5">
                  <CheckCircle2 className="w-3 h-3" /> CURRENTLY SET
                </span>
              )}
            </label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                placeholder={
                  slotMap.stripe_platform_secret_key?.has_value
                    ? "Leave blank to keep current value"
                    : "sk_live_… or sk_test_…"
                }
                className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600"
              >
                {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {details.stripe_platform_secret_key && (
              <p className="text-xs text-danger-600 font-medium flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                {details.stripe_platform_secret_key}
              </p>
            )}
            <p className="text-[11px] text-ink-400">
              From Step 4 above. Starts with{" "}
              <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">sk_test_</code>{" "}
              or <code className="font-mono bg-ink-100 px-1 py-0.5 rounded">sk_live_</code>
              . Encrypted at rest with pgcrypto.
            </p>
          </div>

          {error && !Object.keys(details).length && (
            <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-2 text-sm text-success-700 bg-success-50 border border-success-200 px-4 py-3 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
              Saved — redirecting to Providers…
            </div>
          )}

          <div className="flex justify-between items-center pt-2">
            <Link
              href="/providers/stripe"
              className="text-sm font-semibold text-ink-600 hover:text-ink-900 transition-colors"
            >
              ← Back to Providers
            </Link>
            <button
              onClick={save}
              disabled={saving || (!clientId.trim() && !secretKey.trim())}
              className="px-5 py-2.5 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
            >
              {saving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Validating with Stripe…
                </>
              ) : (
                <>
                  Save platform keys
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ───── Troubleshooting ───── */}
      <details className="mt-8 p-5 bg-ink-50 border border-ink-200 rounded-xl">
        <summary className="cursor-pointer text-sm font-semibold text-ink-700 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-ink-500" />
          Troubleshooting common errors
        </summary>
        <div className="mt-4 space-y-4 text-sm text-ink-600">
          <Trouble
            symptom="Invalid Stripe secret key"
            fix={
              <>
                The key you pasted doesn't authenticate with Stripe. Re-copy from{" "}
                <a
                  href="https://dashboard.stripe.com/apikeys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-bold text-brand-700"
                >
                  dashboard.stripe.com/apikeys
                </a>{" "}
                — make sure you grabbed the <strong>Secret key</strong>, not the
                Publishable key.
              </>
            }
          />
          <Trouble
            symptom="Connect client ID must start with ca_"
            fix={
              <>
                You probably pasted an API key by mistake. The Connect Client ID lives at{" "}
                <a
                  href="https://dashboard.stripe.com/settings/connect/onboarding-options"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-bold text-brand-700"
                >
                  Settings → Connect → Integration → Client ID
                </a>
                , not on the API keys page.
              </>
            }
          />
          <Trouble
            symptom="connect_disabled (during OAuth)"
            fix={
              <>
                Your Stripe account has Connect disabled. Open{" "}
                <a
                  href="https://dashboard.stripe.com/settings/connect/onboarding-options"
                  target="_blank"
                  rel="noreferrer"
                  className="underline font-bold text-brand-700"
                >
                  Stripe Connect settings
                </a>{" "}
                and click "Get started" / "Activate". Takes ~2 minutes for Standard
                accounts, no Stripe approval needed.
              </>
            }
          />
          <Trouble
            symptom="redirect_uri_mismatch (during OAuth)"
            fix={
              <>
                You haven't added the redirect URI (Step 2) to your Stripe Connect
                settings yet. Copy the exact URL from above and paste it into the
                Redirects section.
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
  done,
  children,
}: {
  number: number
  title: string
  done: boolean
  children: React.ReactNode
}) {
  return (
    <li className="bg-white border border-ink-200 rounded-xl overflow-hidden">
      <div className="p-5 flex gap-4">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
            done
              ? "bg-success-50 text-success-700 border-2 border-success-300"
              : "bg-brand-50 text-brand-700 border-2 border-brand-300"
          }`}
        >
          {done ? <Check className="w-4 h-4" /> : number}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-ink-900 mb-2 flex items-center gap-2">
            {title}
            {done && (
              <span className="text-[10px] text-success-700 font-bold inline-flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3" /> SAVED
              </span>
            )}
          </h3>
          {children}
        </div>
      </div>
    </li>
  )
}

function Trouble({ symptom, fix }: { symptom: string; fix: React.ReactNode }) {
  return (
    <div className="p-3 bg-white border border-ink-200 rounded-lg">
      <div className="text-xs font-bold text-danger-700 mb-1 font-mono">{symptom}</div>
      <div className="text-xs text-ink-600 leading-relaxed">{fix}</div>
    </div>
  )
}
