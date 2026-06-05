"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  CreditCard,
  KeyRound,
  Package,
  Sparkles,
} from "lucide-react"
import { Button, ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type Step = 1 | 2 | 3 | 4

const STEPS = [
  { num: 1, label: "App name" },
  { num: 2, label: "Connect provider" },
  { num: 3, label: "First product" },
  { num: 4, label: "Get API key" },
]

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [appName, setAppName] = useState("")
  const [tenant, setTenant] = useState<{
    id: string
    api_key_test: string
    api_key_live: string
  } | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function provision() {
    setCreating(true)
    setError(null)
    const res = await fetch("/api/onboarding/provision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app_name: appName }),
    })
    setCreating(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? "Could not create your app. Try again.")
      return
    }
    const t = await res.json()
    setTenant(t)
    setStep(2)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/40 via-white to-white">
      {/* Top bar */}
      <header className="border-b border-ink-100 bg-white/70 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm shadow-brand-500/30">
              <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-ink-900 leading-none">
                PayCraft
              </div>
              <div className="text-[10px] text-ink-400 font-medium mt-0.5">
                by MobileByteSensei
              </div>
            </div>
          </Link>
          <Badge tone="neutral">Step {step} of 4</Badge>
        </div>
        {/* Progress bar */}
        <div className="max-w-3xl mx-auto px-6 pb-4">
          <div className="flex items-center gap-1">
            {STEPS.map((s) => (
              <div
                key={s.num}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  s.num <= step ? "bg-brand-600" : "bg-ink-200"
                }`}
              />
            ))}
          </div>
          <div className="grid grid-cols-4 gap-1 mt-2 text-2xs">
            {STEPS.map((s) => (
              <span
                key={s.num}
                className={`tracking-wide ${
                  s.num === step
                    ? "font-bold text-brand-700"
                    : s.num < step
                    ? "font-medium text-success-600"
                    : "text-ink-400"
                }`}
              >
                {s.num < step ? "✓ " : ""}
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16 animate-slide-up">
        {step === 1 && (
          <Step1
            appName={appName}
            setAppName={setAppName}
            onContinue={provision}
            creating={creating}
            error={error}
          />
        )}
        {step === 2 && tenant && (
          <Step2 tenant={tenant} onContinue={() => setStep(3)} onBack={() => setStep(1)} />
        )}
        {step === 3 && tenant && (
          <Step3 tenant={tenant} onContinue={() => setStep(4)} onBack={() => setStep(2)} />
        )}
        {step === 4 && tenant && (
          <Step4
            tenant={tenant}
            copied={copied}
            setCopied={setCopied}
            onFinish={() => router.push("/dashboard")}
            onBack={() => setStep(3)}
          />
        )}
      </main>
    </div>
  )
}

function Step1({
  appName,
  setAppName,
  onContinue,
  creating,
  error,
}: {
  appName: string
  setAppName: (v: string) => void
  onContinue: () => void
  creating: boolean
  error: string | null
}) {
  return (
    <div className="max-w-md mx-auto">
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">
        Name your app
      </h1>
      <p className="text-ink-500 text-sm mt-2">
        This is the name shown to your team in the dashboard. You can rename
        anytime.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onContinue()
        }}
        className="mt-8 space-y-4"
      >
        <input
          required
          autoFocus
          value={appName}
          onChange={(e) => setAppName(e.target.value)}
          placeholder="Reels Downloader"
          className="input text-base !py-3"
        />
        {error && (
          <div className="rounded-lg bg-danger-50 border border-danger-200 text-danger-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-2xs text-ink-400">
            We'll provision a tenant + API keys instantly.
          </span>
          <Button
            type="submit"
            loading={creating}
            disabled={!appName.trim()}
            trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
          >
            Create app
          </Button>
        </div>
      </form>
    </div>
  )
}

function Step2({
  onContinue,
  onBack,
}: {
  tenant: { id: string }
  onContinue: () => void
  onBack: () => void
}) {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">
        Connect a payment provider
      </h1>
      <p className="text-ink-500 text-sm mt-2 max-w-2xl">
        We'll route checkout through this provider when your users hit the
        paywall. You can add more later from your dashboard.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
        <div className="relative rounded-2xl border-2 border-brand-500 bg-white p-6 shadow-lg shadow-brand-500/15">
          <Badge tone="brand" className="absolute -top-3 left-5">
            Recommended
          </Badge>
          <div className="text-2xl font-bold text-[#635BFF]">stripe</div>
          <p className="text-sm text-ink-600 mt-3 leading-relaxed">
            Connect via OAuth — about 30 seconds. Works in 40+ countries with
            cards, UPI, wallets, and bank debits.
          </p>
          <ul className="text-xs text-ink-500 mt-4 space-y-1">
            <li className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
              Live + Test modes
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
              Fee: 2.9% + $0.30 / charge
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
              40+ countries
            </li>
          </ul>
          <Button
            onClick={onContinue}
            size="lg"
            className="w-full mt-6 justify-center"
            trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
          >
            Connect with Stripe
          </Button>
        </div>

        <div className="rounded-2xl border border-ink-200 bg-white p-6">
          <div className="text-2xl font-bold text-[#072654]">Razorpay</div>
          <p className="text-sm text-ink-600 mt-3 leading-relaxed">
            Manual key entry. Best for India-focused apps with UPI, cards,
            netbanking, and wallets.
          </p>
          <ul className="text-xs text-ink-500 mt-4 space-y-1">
            <li className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
              Test + Live modes
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
              Fee: 2% cards / 0% UPI
            </li>
            <li className="flex items-center gap-1.5">
              <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
              India + 100+ countries
            </li>
          </ul>
          <Button
            onClick={onContinue}
            variant="secondary"
            size="lg"
            className="w-full mt-6 justify-center"
          >
            Add Razorpay keys
          </Button>
        </div>
      </div>

      <div className="text-center mt-8 text-xs text-ink-500">
        Or{" "}
        <button
          type="button"
          onClick={onContinue}
          className="text-brand-600 hover:text-brand-700 font-medium underline"
        >
          skip for now
        </button>{" "}
        — connect later from the dashboard.
      </div>

      <div className="flex items-center justify-between mt-10">
        <Button
          onClick={onBack}
          variant="ghost"
          leading={<ArrowLeft className="w-4 h-4" strokeWidth={2} />}
        >
          Back
        </Button>
      </div>
    </div>
  )
}

function Step3({
  onContinue,
  onBack,
}: {
  tenant: { id: string }
  onContinue: () => void
  onBack: () => void
}) {
  const [type, setType] = useState<"subscription" | "trial" | "lifetime">(
    "subscription",
  )
  const [sku, setSku] = useState("monthly")
  const [name, setName] = useState("Monthly Premium")
  const [price, setPrice] = useState(199)

  async function save() {
    await fetch("/api/products", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku,
        type,
        display_name: name,
        interval: type === "subscription" ? "month" : null,
        base_price_cents: price,
        base_currency: "USD",
        display_order: 0,
        active: true,
      }),
    })
    onContinue()
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-brand-50 mx-auto flex items-center justify-center mb-4">
        <Package className="w-5 h-5 text-brand-600" strokeWidth={2} />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900 text-center">
        Create your first product
      </h1>
      <p className="text-ink-500 text-sm mt-2 text-center">
        You can edit, add trials, and configure locale pricing later.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="mt-8 space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          {(["subscription", "trial", "lifetime"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg border p-3 text-sm capitalize transition-all ${
                type === t
                  ? "border-brand-500 ring-2 ring-brand-100 text-brand-700 bg-brand-50/50"
                  : "border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <input
          required
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          placeholder="SKU (e.g. monthly)"
          className="input"
        />
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name (e.g. Monthly Premium)"
          className="input"
        />
        {type !== "trial" && (
          <input
            required
            type="number"
            min={0}
            value={price}
            onChange={(e) => setPrice(parseInt(e.target.value || "0"))}
            placeholder="Base price (cents)"
            className="input"
          />
        )}
        <div className="flex items-center justify-between mt-6">
          <Button
            type="button"
            onClick={onBack}
            variant="ghost"
            leading={<ArrowLeft className="w-4 h-4" strokeWidth={2} />}
          >
            Back
          </Button>
          <Button
            type="submit"
            trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
          >
            Create product
          </Button>
        </div>
      </form>
    </div>
  )
}

function Step4({
  tenant,
  copied,
  setCopied,
  onFinish,
}: {
  tenant: { api_key_test: string; api_key_live: string }
  copied: boolean
  setCopied: (b: boolean) => void
  onFinish: () => void
  onBack: () => void
}) {
  return (
    <div className="max-w-2xl mx-auto text-center">
      <div className="w-14 h-14 rounded-2xl bg-success-50 mx-auto flex items-center justify-center mb-4">
        <KeyRound className="w-5 h-5 text-success-600" strokeWidth={2} />
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-ink-900">
        Your API keys are ready
      </h1>
      <p className="text-ink-500 text-sm mt-2">
        Use the test key during development and the live key in production.
      </p>

      <div className="mt-8 rounded-2xl bg-ink-950 text-left p-6 shadow-xl shadow-brand-900/20">
        <div className="text-2xs uppercase tracking-widest font-semibold text-ink-500 mb-2">
          Test key
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-ink-200 break-all">
            {tenant.api_key_test}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(tenant.api_key_test)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="p-2 rounded text-ink-400 hover:text-white hover:bg-ink-800 transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-success-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
        <div className="text-2xs uppercase tracking-widest font-semibold text-ink-500 mt-5 mb-2">
          Live key
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-ink-200 break-all">
            {tenant.api_key_live.substring(0, 12)}•••••••••••••••••••
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(tenant.api_key_live)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
            className="p-2 rounded text-ink-400 hover:text-white hover:bg-ink-800 transition-colors"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-xl bg-warning-50 border border-warning-200 px-4 py-3 text-left">
        <p className="text-xs text-warning-700">
          Save the <code className="font-mono">pk_live_…</code> key now — it
          won't be shown in full again. You can rotate it anytime from{" "}
          <strong>Settings → API keys</strong>.
        </p>
      </div>

      <div className="mt-8 rounded-xl bg-ink-100/80 px-5 py-4 text-left">
        <p className="text-xs text-ink-700">
          <strong>Drop this into your app:</strong>
        </p>
        <pre className="text-xs font-mono text-ink-700 mt-2 overflow-x-auto">
          {`PayCraft.initialize(apiKey = "${tenant.api_key_test.substring(0, 16)}…")\nPayCraftPaywall()`}
        </pre>
      </div>

      <Button
        onClick={onFinish}
        size="lg"
        className="mt-8"
        trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
      >
        Go to dashboard
      </Button>
    </div>
  )
}
