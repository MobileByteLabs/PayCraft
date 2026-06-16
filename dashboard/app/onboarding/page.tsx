"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  KeyRound,
  Package,
  Rocket,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type Step = 1 | 2 | 3 | 4

const STEPS = [
  { num: 1, label: "App name" },
  { num: 2, label: "Connect provider" },
  { num: 3, label: "Create product" },
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
    <div className="min-h-screen bg-ink-50 flex flex-col items-center justify-center p-4">
      {/* Brand logo */}
      <div className="mb-8 flex flex-col items-center">
        <div className="w-10 h-10 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-sm shadow-brand-500/30 mb-2">
          <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
        <div className="flex flex-col items-center">
          <span className="text-ink-900 font-bold tracking-tight text-xl leading-none">PayCraft</span>
          <span className="text-ink-500 text-[10px] font-medium tracking-widest uppercase mt-0.5">by MobileByteSensei</span>
        </div>
      </div>

      {/* Onboarding card */}
      <main className="w-full max-w-[640px] bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
        {/* Step progress header */}
        <div className="px-8 py-6 border-b border-ink-100 bg-ink-50/50">
          <nav className="flex items-center justify-between">
            {STEPS.map((s, i) => {
              const isActive = s.num === step
              const isDone = s.num < step
              return (
                <div key={s.num} className="flex items-center flex-1">
                  <div
                    className={`flex flex-col gap-1 items-start ${
                      isActive ? "" : "opacity-50"
                    }`}
                  >
                    <span
                      className={`text-[10px] uppercase tracking-wider font-bold ${
                        isActive || isDone ? "text-brand-600" : "text-ink-400"
                      }`}
                    >
                      Step {s.num}
                    </span>
                    <span
                      className={`text-xs font-semibold ${
                        isActive ? "text-brand-600" : isDone ? "text-ink-500" : "text-ink-500"
                      }`}
                    >
                      {s.label}
                    </span>
                    <div
                      className={`h-1 rounded-full mt-1 transition-all ${
                        isActive ? "w-24 bg-brand-600" : isDone ? "w-24 bg-brand-400" : "w-12 bg-ink-200"
                      }`}
                    />
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className="flex-1 h-[1px] bg-ink-200 mx-4 mt-6" />
                  )}
                </div>
              )
            })}
          </nav>
        </div>

        {/* Step content */}
        <div className="p-8 md:p-12">
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
            <Step2
              tenant={tenant}
              onContinue={() => setStep(3)}
              onBack={() => setStep(1)}
            />
          )}
          {step === 3 && tenant && (
            <Step3
              tenant={tenant}
              onContinue={() => setStep(4)}
              onBack={() => setStep(2)}
            />
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
        </div>

        {/* Footer actions */}
        <div className="px-8 py-6 bg-ink-50 border-t border-ink-200 flex items-center justify-between">
          {step === 1 ? (
            <button
              type="button"
              disabled
              className="px-4 py-2 text-sm font-medium text-ink-400 cursor-not-allowed"
            >
              Back
            </button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              leading={<ArrowLeft className="w-4 h-4" strokeWidth={2} />}
              onClick={() => setStep((step - 1) as Step)}
            >
              Back
            </Button>
          )}

          {step === 1 && (
            <Button
              type="button"
              onClick={provision}
              loading={creating}
              disabled={!appName.trim()}
              trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
            >
              Continue
            </Button>
          )}
          {step === 2 && (
            <Button
              type="button"
              onClick={() => setStep(3)}
              trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
            >
              Continue
            </Button>
          )}
          {step === 3 && (
            <Button
              type="button"
              onClick={() => setStep(4)}
              trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
            >
              Continue
            </Button>
          )}
          {step === 4 && (
            <Button
              type="button"
              onClick={() => router.push("/dashboard")}
              trailing={<ArrowRight className="w-4 h-4" strokeWidth={2.5} />}
            >
              Go to dashboard
            </Button>
          )}
        </div>
      </main>

      {/* Global footer */}
      <footer className="mt-8 text-center">
        <div className="flex justify-center gap-6 mb-4">
          <Link href="#" className="text-xs text-ink-400 hover:text-ink-600 transition-colors">
            Documentation
          </Link>
          <Link href="#" className="text-xs text-ink-400 hover:text-ink-600 transition-colors">
            Privacy Policy
          </Link>
          <Link href="#" className="text-xs text-ink-400 hover:text-ink-600 transition-colors">
            Support
          </Link>
        </div>
        <p className="text-[11px] text-ink-400 font-medium tracking-wide">
          PayCraft by MobileByteSensei · © 2026 MobileByteSensei Pvt Ltd
        </p>
      </footer>
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
    <div>
      <header className="mb-10">
        <h1 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-2">
          Name your app
        </h1>
        <p className="text-ink-500 text-sm">
          This is how PayCraft identifies your app across all platforms.
        </p>
      </header>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onContinue()
        }}
        className="space-y-6"
      >
        <div className="space-y-2">
          <label
            htmlFor="app_name"
            className="block text-sm font-semibold text-ink-700"
          >
            App name
          </label>
          <input
            id="app_name"
            required
            autoFocus
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="e.g. Acme, Photo Pro, FitTrack"
            className="w-full px-4 py-3 rounded-lg border border-ink-300 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-ink-900 placeholder:text-ink-400 text-sm"
          />
          <p className="text-xs text-ink-400">You can change this later in Settings.</p>
        </div>

        {error && (
          <div className="rounded-lg bg-danger-50 border border-danger-200 text-danger-700 px-3 py-2 text-sm">
            {error}
          </div>
        )}

        {/* KMP context callout */}
        <div className="p-4 bg-brand-50 rounded-lg border border-brand-100 flex items-start gap-4">
          <div className="p-2 bg-white rounded-md border border-brand-200 shrink-0">
            <Rocket className="w-5 h-5 text-brand-600" strokeWidth={2} />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-brand-900">
              Setting up Kotlin Multiplatform?
            </h4>
            <p className="text-xs text-brand-700 leading-relaxed mt-0.5">
              PayCraft automatically handles platform-specific billing logic
              for Android, iOS, and Web using your app name as the project anchor.
            </p>
          </div>
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
      <header className="mb-10">
        <h1 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-2">
          Connect a payment provider
        </h1>
        <p className="text-ink-500 text-sm">
          We'll route checkout through this provider when your users hit the
          paywall. You can add more later from your dashboard.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="relative rounded-xl border-2 border-brand-500 bg-white p-5 shadow-lg shadow-brand-500/10">
          <Badge tone="brand" className="absolute -top-3 left-5">
            Recommended
          </Badge>
          <div className="text-xl font-bold text-[#635BFF] mb-3">stripe</div>
          <p className="text-sm text-ink-600 leading-relaxed">
            Connect via OAuth — about 30 seconds. Works in 40+ countries with
            cards, UPI, wallets, and bank debits.
          </p>
          <ul className="text-xs text-ink-500 mt-4 space-y-1">
            {["Live + Test modes", "Fee: 2.9% + $0.30 / charge", "40+ countries"].map(
              (item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
                  {item}
                </li>
              ),
            )}
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

        <div className="rounded-xl border border-ink-200 bg-white p-5">
          <div className="text-xl font-bold text-[#072654] mb-3">Razorpay</div>
          <p className="text-sm text-ink-600 leading-relaxed">
            Manual key entry. Best for India-focused apps with UPI, cards,
            netbanking, and wallets.
          </p>
          <ul className="text-xs text-ink-500 mt-4 space-y-1">
            {["Test + Live modes", "Fee: 2% cards / 0% UPI", "India + 100+ countries"].map(
              (item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
                  {item}
                </li>
              ),
            )}
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

      <div className="text-center mt-6 text-xs text-ink-500">
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
    <div>
      <header className="mb-8">
        <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
          <Package className="w-5 h-5 text-brand-600" strokeWidth={2} />
        </div>
        <h1 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-2">
          Create your first product
        </h1>
        <p className="text-ink-500 text-sm">
          You can edit, add trials, and configure locale pricing later.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-3 gap-2">
          {(["subscription", "trial", "lifetime"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-lg border p-2.5 text-xs capitalize transition-all font-medium ${
                type === t
                  ? "border-brand-500 ring-2 ring-brand-100 text-brand-700 bg-brand-50/50"
                  : "border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-ink-700">SKU</label>
          <input
            required
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="e.g. monthly"
            className="w-full px-4 py-2.5 rounded-lg border border-ink-300 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-ink-900 text-sm"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-ink-700">
            Display name
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Monthly Premium"
            className="w-full px-4 py-2.5 rounded-lg border border-ink-300 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-ink-900 text-sm"
          />
        </div>
        {type !== "trial" && (
          <div className="space-y-2">
            <label className="block text-sm font-semibold text-ink-700">
              Base price (cents)
            </label>
            <input
              required
              type="number"
              min={0}
              value={price}
              onChange={(e) => setPrice(parseInt(e.target.value || "0"))}
              placeholder="199"
              className="w-full px-4 py-2.5 rounded-lg border border-ink-300 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none transition-all text-ink-900 text-sm"
            />
          </div>
        )}
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
    <div>
      <header className="mb-8">
        <div className="w-12 h-12 rounded-2xl bg-success-50 flex items-center justify-center mb-4">
          <KeyRound className="w-5 h-5 text-success-600" strokeWidth={2} />
        </div>
        <h1 className="text-2xl font-extrabold text-ink-900 tracking-tight mb-2">
          Your API keys are ready
        </h1>
        <p className="text-ink-500 text-sm">
          Use the test key during development and the live key in production.
        </p>
      </header>

      <div className="rounded-2xl bg-ink-950 text-left p-5 shadow-xl shadow-brand-900/20">
        <div className="text-[10px] uppercase tracking-widest font-semibold text-ink-500 mb-2">
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
        <div className="text-[10px] uppercase tracking-widest font-semibold text-ink-500 mt-5 mb-2">
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

      <div className="mt-4 rounded-xl bg-warning-50 border border-warning-200 px-4 py-3">
        <p className="text-xs text-warning-700">
          Save the <code className="font-mono">pk_live_…</code> key now — it
          won't be shown in full again. You can rotate it anytime from{" "}
          <strong>Settings → API keys</strong>.
        </p>
      </div>

      <div className="mt-4 rounded-xl bg-ink-100/80 px-5 py-4">
        <p className="text-xs text-ink-700">
          <strong>Drop this into your app:</strong>
        </p>
        <pre className="text-xs font-mono text-ink-700 mt-2 overflow-x-auto">
          {`PayCraft.initialize(apiKey = "${tenant.api_key_test.substring(0, 16)}…")\nPayCraftPaywall()`}
        </pre>
      </div>
    </div>
  )
}
