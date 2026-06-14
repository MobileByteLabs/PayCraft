'use client'

import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronRight, Eye, EyeOff, ArrowLeft, CheckCircle2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

interface KeyPair {
  key_id: string
  key_secret: string
  webhook_secret: string
}

function KeyPairSection({
  label,
  idPlaceholder,
  value,
  onChange,
}: {
  label: string
  idPlaceholder: string
  value: KeyPair
  onChange: (v: KeyPair) => void
}) {
  const [showSecret, setShowSecret] = useState(false)
  return (
    <div className="space-y-4">
      <h4 className="text-sm font-bold text-ink-700">{label}</h4>
      <div className="space-y-2">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">Key ID</label>
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder={idPlaceholder}
          value={value.key_id}
          onChange={(e) => onChange({ ...value, key_id: e.target.value })}
        />
      </div>
      <div className="space-y-2">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">Key Secret</label>
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500 pr-10"
            placeholder="••••••••••••"
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
      </div>
      <div className="space-y-2">
        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400 block">Webhook Secret</label>
        <input
          type="text"
          className="w-full px-4 py-2.5 bg-ink-50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
          placeholder="From Razorpay dashboard"
          value={value.webhook_secret}
          onChange={(e) => onChange({ ...value, webhook_secret: e.target.value })}
        />
      </div>
    </div>
  )
}

export default function RazorpayKeysPage() {
  const router = useRouter()
  const [openStep, setOpenStep] = useState<number | null>(1)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [test, setTest] = useState<KeyPair>({ key_id: "", key_secret: "", webhook_secret: "" })
  const [live, setLive] = useState<KeyPair>({ key_id: "", key_secret: "", webhook_secret: "" })

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/providers/razorpay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          test_key_id: test.key_id,
          test_key_secret: test.key_secret,
          test_webhook_secret: test.webhook_secret,
          live_key_id: live.key_id,
          live_key_secret: live.key_secret,
          live_webhook_secret: live.webhook_secret,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Save failed")
      setSaved(true)
      setTimeout(() => router.push("/providers?connected=razorpay"), 1500)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  const allFilled = test.key_id && test.key_secret && test.webhook_secret &&
    live.key_id && live.key_secret && live.webhook_secret

  return (
    <div>
      <div className="mb-10 pt-10">
        <nav className="flex items-center gap-2 text-xs font-medium text-ink-400 mb-2">
          <Link href="/settings" className="hover:text-ink-600 transition-colors">Settings</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/providers" className="hover:text-ink-600 transition-colors">Payment Providers</Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-ink-900">Razorpay</span>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/providers" className="w-10 h-10 flex items-center justify-center bg-white border border-ink-200 rounded-xl hover:border-ink-300 hover:shadow-sm transition-all text-ink-600">
            <ArrowLeft className="w-4 h-4" strokeWidth={2} />
          </Link>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-ink-900 tracking-tight">Razorpay</h2>
            {saved ? <Badge tone="success" dot>Connected</Badge> : <Badge tone="warning">Not connected</Badge>}
          </div>
        </div>
      </div>

      <div className="max-w-2xl space-y-8">
        <Card className="shadow-sm">
          <div className="p-8 border-b border-ink-100">
            <h3 className="text-lg font-bold text-ink-900">API Credentials</h3>
            <p className="text-sm text-ink-500 mt-1">
              Enter both test and live key pairs. PayCraft validates each pair against Razorpay before saving.
            </p>
          </div>
          <CardBody className="p-8 space-y-8">
            <KeyPairSection
              label="Test keys (rzp_test_...)"
              idPlaceholder="rzp_test_..."
              value={test}
              onChange={setTest}
            />
            <hr className="border-ink-100" />
            <KeyPairSection
              label="Live keys (rzp_live_...)"
              idPlaceholder="rzp_live_..."
              value={live}
              onChange={setLive}
            />

            {error && (
              <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
                {error}
              </div>
            )}
            {saved && (
              <div className="flex items-center gap-2 text-sm text-success-700 bg-success-50 border border-success-200 px-4 py-3 rounded-lg">
                <CheckCircle2 className="w-4 h-4" />
                Keys validated and saved — redirecting…
              </div>
            )}
          </CardBody>
          <div className="p-8 bg-ink-50/50 rounded-b-xl border-t border-ink-100 flex justify-end">
            <Button
              variant="primary"
              size="lg"
              onClick={save}
              disabled={!allFilled || saving || saved}
            >
              {saving ? "Validating & saving…" : "Save Razorpay keys"}
            </Button>
          </div>
        </Card>

        <div className="space-y-3">
          <h4 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest px-1">
            Setup Instructions
          </h4>
          {SETUP_STEPS.map((step) => (
            <div key={step.id} className="bg-white border border-ink-200 rounded-xl overflow-hidden">
              <button
                type="button"
                className="w-full flex items-center justify-between p-4 text-left hover:bg-ink-50 transition-colors"
                onClick={() => setOpenStep(openStep === step.id ? null : step.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 flex items-center justify-center bg-ink-100 text-ink-600 text-[12px] font-bold rounded-full flex-shrink-0">
                    {step.id}
                  </span>
                  <span className="text-sm font-semibold text-ink-900">{step.title}</span>
                </div>
                <ChevronRight
                  className={`w-4 h-4 text-ink-400 transition-transform flex-shrink-0 ${openStep === step.id ? "rotate-90" : ""}`}
                  strokeWidth={2}
                />
              </button>
              {openStep === step.id && (
                <div
                  className="px-12 pb-5 text-[13px] text-ink-500 leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: step.content }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const SETUP_STEPS = [
  {
    id: 1,
    title: "Create API keys in Razorpay Dashboard",
    content:
      "Go to your Razorpay Dashboard → Settings → API Keys. Generate both <strong>Test Mode</strong> and <strong>Live Mode</strong> key pairs.",
  },
  {
    id: 2,
    title: "Enable webhook events",
    content:
      "In Webhooks, add <code class=\"bg-ink-100 px-1 rounded text-brand-600\">/functions/v1/razorpay-webhook/{tenant_id}</code> as the endpoint. Enable <code>subscription.charged</code> and <code>subscription.cancelled</code>.",
  },
  {
    id: 3,
    title: "Copy webhook secret",
    content:
      "During webhook creation, Razorpay shows a <strong>Secret</strong> field. Set a strong random string there, then paste it into both test + live Webhook Secret fields above.",
  },
]
