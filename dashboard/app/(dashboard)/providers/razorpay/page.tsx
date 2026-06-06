'use client'

import Link from "next/link"
import { useState } from "react"
import { ChevronRight, Eye, EyeOff, ArrowLeft } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardBody } from "@/components/ui/card"

export default function RazorpayKeysPage() {
  const [showSecret, setShowSecret] = useState(false)
  const [testMode, setTestMode] = useState(false)
  const [openStep, setOpenStep] = useState<number | null>(1)
  const [form, setForm] = useState({
    keyId: "",
    keySecret: "",
    webhookSecret: "",
  })

  const handleChange = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleTestConnection = () => {
    // Mock — no real API call
    alert("Connection test triggered (no real call in demo mode)")
  }

  return (
    <div>
      {/* Breadcrumb + header */}
      <div className="mb-10 pt-10">
        <nav className="flex items-center gap-2 text-xs font-medium text-ink-400 mb-2">
          <Link href="/settings" className="hover:text-ink-600 transition-colors">
            Settings
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <Link href="/providers" className="hover:text-ink-600 transition-colors">
            Payment Providers
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
            <h2 className="text-2xl font-bold text-ink-900 tracking-tight">
              Razorpay
            </h2>
            <Badge tone="warning">Not connected</Badge>
          </div>
        </div>
      </div>

      <div className="max-w-2xl">
        {/* Credentials form card */}
        <Card className="mb-8 shadow-sm">
          <div className="p-8 border-b border-ink-100">
            <h3 className="text-lg font-bold text-ink-900">
              Connect Razorpay
            </h3>
            <p className="text-sm text-ink-500 mt-1">
              Enter your Razorpay API credentials. PayCraft uses these to verify
              webhooks and fetch subscription data.
            </p>
          </div>

          <CardBody className="p-8 space-y-6">
            {/* Key ID */}
            <div className="space-y-2">
              <label className="text-[13px] font-semibold text-ink-700 block">
                Key ID
              </label>
              <input
                type="text"
                className="input w-full"
                placeholder="rzp_live_..."
                value={form.keyId}
                onChange={(e) => handleChange("keyId", e.target.value)}
              />
            </div>

            {/* Key Secret */}
            <div className="space-y-2">
              <label className="text-[13px] font-semibold text-ink-700 block">
                Key Secret
              </label>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  className="input w-full pr-10"
                  placeholder="rzp_live_secret..."
                  value={form.keySecret}
                  onChange={(e) => handleChange("keySecret", e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600 transition-colors"
                >
                  {showSecret ? (
                    <EyeOff className="w-4 h-4" strokeWidth={2} />
                  ) : (
                    <Eye className="w-4 h-4" strokeWidth={2} />
                  )}
                </button>
              </div>
            </div>

            {/* Webhook Secret */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-[13px] font-semibold text-ink-700">
                  Webhook Secret
                </label>
                <a
                  href="https://razorpay.com/docs/webhooks/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-600 font-medium hover:underline"
                >
                  Where to find this?
                </a>
              </div>
              <input
                type="text"
                className="input w-full"
                placeholder="From Razorpay dashboard"
                value={form.webhookSecret}
                onChange={(e) => handleChange("webhookSecret", e.target.value)}
              />
            </div>
          </CardBody>

          {/* Form footer */}
          <div className="p-8 bg-ink-50/50 rounded-b-xl border-t border-ink-100 flex justify-center">
            <Button
              variant="primary"
              size="lg"
              className="w-full md:w-auto px-8"
              onClick={handleTestConnection}
            >
              Test connection
            </Button>
          </div>
        </Card>

        {/* Setup instructions (accordion-style) */}
        <div className="space-y-3 mb-10">
          <h4 className="text-[11px] font-bold text-ink-400 uppercase tracking-widest px-1">
            Setup Instructions
          </h4>

          {SETUP_STEPS.map((step) => (
            <div
              key={step.id}
              className="bg-white border border-ink-200 rounded-xl overflow-hidden"
            >
              <button
                type="button"
                className="w-full flex items-center justify-between p-4 text-left hover:bg-ink-50 transition-colors"
                onClick={() =>
                  setOpenStep(openStep === step.id ? null : step.id)
                }
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 flex items-center justify-center bg-ink-100 text-ink-600 text-[12px] font-bold rounded-full flex-shrink-0">
                    {step.id}
                  </span>
                  <span className="text-sm font-semibold text-ink-900">
                    {step.title}
                  </span>
                </div>
                <ChevronRight
                  className={`w-4 h-4 text-ink-400 transition-transform flex-shrink-0 ${
                    openStep === step.id ? "rotate-90" : ""
                  }`}
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

        {/* Test mode toggle */}
        <div className="flex items-center justify-between p-6 bg-brand-50/50 border border-brand-100 rounded-xl">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-brand-100 rounded-full flex items-center justify-center">
              <span className="text-brand-600 text-base">⚗</span>
            </div>
            <div>
              <h4 className="text-sm font-bold text-ink-900">
                Enable Razorpay Test Mode
              </h4>
              <p className="text-xs text-ink-500">
                Use test credentials to simulate transactions without real money.
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={testMode}
              onChange={(e) => setTestMode(e.target.checked)}
            />
            <div className="w-11 h-6 bg-ink-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-ink-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600" />
          </label>
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
      "Go to your Razorpay Dashboard &gt; Settings &gt; API Keys. Generate a new set of keys if you haven't already. Ensure you are copying the <strong>Live Mode</strong> keys for production environments.",
  },
  {
    id: 2,
    title: "Enable webhook events",
    content:
      "In the Webhooks section, add <code class=\"bg-ink-100 px-1 rounded text-brand-600\">https://api.paycraft.cloud/hooks/razorpay</code> as the endpoint and enable <code class=\"bg-ink-100 px-1 rounded\">subscription.charged</code> and <code class=\"bg-ink-100 px-1 rounded\">subscription.cancelled</code> events.",
  },
  {
    id: 3,
    title: "Copy webhook secret",
    content:
      "During webhook creation, Razorpay will ask you to set a &lsquo;Secret&rsquo;. Enter a strong random string, save it in Razorpay, and then paste that exact same string into the <strong>Webhook Secret</strong> field above.",
  },
]
