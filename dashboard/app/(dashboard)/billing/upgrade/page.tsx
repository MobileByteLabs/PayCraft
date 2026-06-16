"use client"

import { useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { PageHeader } from "@/components/ui/page-header"
import { clsx } from "clsx"

const TIERS = [
  {
    name: "free" as const,
    label: "Free",
    description: "For hobby projects",
    monthly: "$0",
    line: "/mo",
    features: [
      "100 Subscribers",
      "1 Provider limit",
      "7-day analytics",
      "Community support",
    ],
    cta: "Current plan",
    tone: "neutral" as const,
    isCurrent: true,
  },
  {
    name: "pro" as const,
    label: "Pro",
    description: "For growing startups",
    monthly: "$29",
    line: "/mo",
    features: [
      "Unlimited Subscribers",
      "3 Provider limits",
      "90-day analytics",
      "Priority support",
      "No attribution footer",
      "Custom paywall branding",
    ],
    cta: "Upgrade to Pro",
    tone: "brand" as const,
    highlight: true,
  },
  {
    name: "enterprise" as const,
    label: "Enterprise",
    description: "For large scale ops",
    monthly: "$99",
    line: "/mo",
    features: [
      "Unlimited everything",
      "365-day analytics",
      "Dedicated support rep",
      "SOC 2 / GDPR package",
      "Self-host option",
    ],
    cta: "Contact sales",
    tone: "neutral" as const,
    darkBorder: true,
  },
]

const USAGE_METERS = [
  {
    label: "Subscribers",
    current: 47,
    limit: 100,
    pct: 47,
    barColor: "bg-brand-500",
    status: "47% Utilized",
    statusColor: "text-ink-400",
  },
  {
    label: "Events",
    current: "2.3K",
    limit: "10K",
    pct: 23,
    barColor: "bg-blue-500",
    status: "23% Utilized",
    statusColor: "text-ink-400",
  },
  {
    label: "Providers",
    current: 1,
    limit: 1,
    pct: 100,
    barColor: "bg-amber-500",
    status: "Limit Reached",
    statusColor: "text-amber-600",
  },
]

const FAQ = [
  {
    q: "How do I change plans?",
    a: "You can upgrade or downgrade your plan at any time through this dashboard. Upgrades are applied immediately and charges are prorated. Downgrades will take effect at the end of your current billing cycle.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes, you can cancel your subscription whenever you want from the Billing settings page. You'll continue to have access to Pro features until the end of your prepaid period.",
  },
  {
    q: "What happens if I exceed my subscriber limit?",
    a: "On the Free plan, we stop processing new subscribers once you hit 100. On the Pro and Enterprise plans, you have unlimited subscribers so your growth is never throttled.",
  },
]

export default function UpgradePage() {
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

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
        subtitle={
          <>
            You&apos;re on{" "}
            <span className="font-semibold text-ink-900">Free</span>
          </>
        }
        breadcrumb={[
          { label: "Billing", href: "/billing" },
          { label: "Upgrade" },
        ]}
      />

      {/* Pricing Cards */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-12">
        {TIERS.map((t) => (
          <div
            key={t.name}
            className={clsx(
              "bg-white rounded-xl flex flex-col",
              t.highlight
                ? "border-2 border-brand-500 relative lg:scale-105 shadow-xl shadow-brand-500/5"
                : t.darkBorder
                ? "border-2 border-ink-800 hover:border-black transition-all duration-300"
                : "border-2 border-ink-200 hover:border-ink-300 transition-all duration-300",
            )}
          >
            {t.highlight && (
              <div className="bg-brand-500 px-8 py-2 rounded-t-[10px] flex justify-center">
                <span className="text-white text-[10px] font-bold uppercase tracking-[0.2em]">
                  Most popular
                </span>
              </div>
            )}
            <div className="p-8 flex flex-col flex-1">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h3 className="text-xl font-bold text-ink-900">{t.label}</h3>
                  <p className="text-ink-500 text-sm mt-1">{t.description}</p>
                </div>
                {t.isCurrent && (
                  <span className="px-2.5 py-1 bg-ink-100 text-ink-600 text-[10px] font-bold uppercase rounded-md tracking-wider border border-ink-200">
                    Current
                  </span>
                )}
              </div>
              <div className="mb-8">
                <span className="text-4xl font-extrabold text-ink-900">
                  {t.monthly}
                </span>
                <span className="text-ink-500">{t.line}</span>
              </div>
              <ul className="space-y-4 mb-10 flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm">
                    <div
                      className={clsx(
                        "w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0",
                        t.highlight
                          ? "bg-brand-100 text-brand-700"
                          : t.darkBorder
                          ? "bg-ink-100 text-ink-900"
                          : "bg-success-100 text-success-700",
                      )}
                    >
                      <Check className="w-3 h-3" strokeWidth={3} />
                    </div>
                    <span
                      className={clsx(
                        t.highlight ? "font-semibold text-ink-900" : "text-ink-700",
                      )}
                    >
                      {f}
                    </span>
                  </li>
                ))}
              </ul>
              {t.isCurrent ? (
                <button
                  disabled
                  className="w-full py-3 px-4 border border-ink-200 bg-ink-50 text-ink-400 font-semibold rounded-lg cursor-not-allowed"
                >
                  Current plan
                </button>
              ) : t.name === "pro" ? (
                <button
                  onClick={() => go("pro")}
                  disabled={submitting === "pro"}
                  className="w-full py-3 px-4 bg-brand-500 hover:bg-brand-700 text-white font-bold rounded-lg transition-all active:scale-[0.98] shadow-lg shadow-brand-500/20 disabled:opacity-60"
                >
                  {submitting === "pro" ? "Redirecting…" : t.cta}
                </button>
              ) : (
                <button
                  onClick={() => go("enterprise")}
                  className="w-full py-3 px-4 border border-ink-200 text-ink-900 font-bold rounded-lg hover:bg-ink-50 transition-all active:scale-[0.98]"
                >
                  {t.cta}
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      {/* Usage Meters */}
      <section className="mb-12">
        <div className="bg-white border border-ink-200 rounded-xl p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-lg font-bold text-ink-900">
                Current Usage (Free Plan)
              </h3>
              <p className="text-ink-500 text-sm">
                Usage resets on the 1st of every month.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
            {USAGE_METERS.map((m) => (
              <div key={m.label}>
                <div className="flex justify-between text-sm mb-2">
                  <span className="font-medium text-ink-700">{m.label}</span>
                  <span className="text-ink-500">
                    {m.current} / {m.limit}
                  </span>
                </div>
                <div className="w-full h-2 bg-ink-100 rounded-full overflow-hidden">
                  <div
                    className={clsx(
                      "h-full rounded-full transition-all duration-1000",
                      m.barColor,
                    )}
                    style={{ width: `${m.pct}%` }}
                  />
                </div>
                <p
                  className={clsx(
                    "text-[10px] mt-2 uppercase font-bold tracking-wider",
                    m.statusColor,
                  )}
                >
                  {m.status}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto">
        <h3 className="text-xl font-bold text-ink-900 mb-6 text-center">
          Frequently Asked Questions
        </h3>
        <div className="space-y-4">
          {FAQ.map((item, i) => (
            <div
              key={i}
              className="bg-white border border-ink-200 rounded-lg overflow-hidden"
            >
              <button
                className="w-full px-6 py-4 flex items-center justify-between text-left transition-colors hover:bg-ink-50"
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
              >
                <span className="font-semibold text-ink-900">{item.q}</span>
                <ChevronDown
                  className={clsx(
                    "w-5 h-5 text-ink-500 transition-transform duration-200",
                    openFaq === i && "rotate-180",
                  )}
                />
              </button>
              {openFaq === i && (
                <div className="px-6 pb-4 text-ink-500 text-sm leading-relaxed">
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
