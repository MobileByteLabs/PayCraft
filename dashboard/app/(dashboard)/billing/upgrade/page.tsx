"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { PageHeader } from "@/components/ui/page-header"

const TIERS = [
  {
    name: "free" as const,
    label: "Free",
    monthly: "$0",
    line: "forever, no card",
    features: [
      ["100 active subscribers", true],
      ["10,000 webhook events / mo", true],
      ["1 connected provider", true],
      ["1 product", true],
      ["Attribution footer required", false],
      ["7-day analytics retention", true],
    ] as const,
    cta: "Current plan",
    tone: "neutral",
  },
  {
    name: "pro" as const,
    label: "Pro",
    monthly: "$29",
    line: "per month + $0.10 per subscriber over 1,000",
    features: [
      ["1,000 subscribers (then metered)", true],
      ["Unlimited webhook events", true],
      ["Unlimited providers + products", true],
      ["Unlimited team members", true],
      ["Remove attribution footer", true],
      ["90-day analytics retention", true],
    ] as const,
    cta: "Start Pro",
    tone: "brand",
    highlight: true,
  },
  {
    name: "enterprise" as const,
    label: "Enterprise",
    monthly: "Custom",
    line: "self-host license + custom DPA",
    features: [
      ["Everything in Pro, no limits", true],
      ["Self-host (BSL license)", true],
      ["Custom paywall branding", true],
      ["365-day analytics retention", true],
      ["Priority support + SLA", true],
      ["SOC 2 / GDPR / DPA package", true],
    ] as const,
    cta: "Contact sales",
    tone: "neutral",
  },
]

export default function UpgradePage() {
  const [submitting, setSubmitting] = useState<string | null>(null)

  async function go(target: "pro" | "enterprise") {
    if (target === "enterprise") {
      window.location.href =
        "mailto:sales@paycraft.cloud?subject=Enterprise%20inquiry"
      return
    }
    setSubmitting(target)
    const res = await fetch("/api/billing/upgrade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_tier: target }),
    })
    setSubmitting(null)
    const body = await res.json().catch(() => ({}))
    if (body.checkout_url) {
      window.location.href = body.checkout_url
    } else if (body.contact_url) {
      window.location.href = body.contact_url
    }
  }

  return (
    <div>
      <PageHeader
        title="Upgrade plan"
        subtitle="Move to Pro for unlimited providers, larger limits, and no attribution. Or talk to sales about Enterprise self-host."
        breadcrumb={[
          { label: "Billing", href: "/billing" },
          { label: "Upgrade" },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 mt-2 animate-slide-up">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={
              t.highlight
                ? "relative rounded-2xl bg-white p-6 flex flex-col ring-2 ring-brand-500 shadow-xl shadow-brand-500/15"
                : "rounded-2xl border border-ink-200 bg-white p-6 flex flex-col"
            }
          >
            {t.highlight && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge tone="brand" className="!shadow-md">
                  Recommended
                </Badge>
              </div>
            )}
            <div
              className={`text-sm font-semibold ${
                t.highlight ? "text-brand-700" : "text-ink-700"
              }`}
            >
              {t.label}
            </div>
            <div className="mt-3 flex items-baseline">
              <span className="text-4xl font-bold tracking-tight tabular-nums">
                {t.monthly}
              </span>
            </div>
            <p className="text-xs text-ink-500 mt-2">{t.line}</p>
            <ul className="mt-6 space-y-2.5 text-sm flex-1">
              {t.features.map(([label, enabled]) => (
                <li
                  key={label}
                  className={
                    enabled
                      ? "flex items-start gap-2 text-ink-700"
                      : "flex items-start gap-2 text-ink-400"
                  }
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                      enabled
                        ? "bg-success-100 text-success-700"
                        : "bg-ink-100 text-ink-400"
                    }`}
                  >
                    {enabled ? (
                      <Check className="w-2.5 h-2.5" strokeWidth={3} />
                    ) : (
                      <X className="w-2.5 h-2.5" strokeWidth={3} />
                    )}
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ul>
            {t.name === "free" ? (
              <Button
                disabled
                variant="secondary"
                size="lg"
                className="w-full mt-8 justify-center"
              >
                Current plan
              </Button>
            ) : (
              <Button
                onClick={() => go(t.name)}
                loading={submitting === t.name}
                variant={t.highlight ? "primary" : "secondary"}
                size="lg"
                className="w-full mt-8 justify-center"
              >
                {t.cta}
              </Button>
            )}
          </div>
        ))}
      </div>

      <div className="text-center mt-12">
        <p className="text-xs text-ink-500">
          All plans include 24/7 monitoring, automatic webhook retries, and
          rolling backups.
        </p>
      </div>
    </div>
  )
}
