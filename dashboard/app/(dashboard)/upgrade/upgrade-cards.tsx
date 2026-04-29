"use client"

import { useState } from "react"

const plans = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    period: "forever",
    limit: "100 subscribers",
    features: ["1 provider", "Test + Live mode", "Basic analytics", "Community support"],
  },
  {
    id: "pro",
    name: "Pro",
    price: "$49",
    period: "/month",
    limit: "10,000 subscribers",
    features: ["Unlimited providers", "Custom email branding", "Advanced analytics", "Priority support", "Webhook retry"],
    popular: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "$299",
    period: "/month",
    limit: "Unlimited subscribers",
    features: ["Everything in Pro", "Dedicated support", "SLA guarantee", "Custom integrations", "SSO"],
  },
]

export function UpgradeCards({
  currentPlan,
  tenantId,
}: {
  currentPlan: string
  tenantId: string
}) {
  const [loading, setLoading] = useState<string | null>(null)

  async function handleUpgrade(planId: string) {
    if (planId === "free" || planId === currentPlan) return
    setLoading(planId)

    const res = await fetch("/api/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId, tenant_id: tenantId }),
    })

    const data = await res.json()

    if (data.url) {
      window.location.href = data.url
    } else {
      alert(data.error || "Failed to create checkout session")
      setLoading(null)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlan
        return (
          <div
            key={plan.id}
            className={`relative rounded-xl border-2 p-6 ${
              plan.popular
                ? "border-brand-500 shadow-lg"
                : "border-gray-200"
            }`}
          >
            {plan.popular && (
              <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-500 text-white text-xs font-medium px-3 py-1 rounded-full">
                Most Popular
              </span>
            )}
            <h3 className="text-lg font-semibold">{plan.name}</h3>
            <div className="mt-2">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="text-gray-500">{plan.period}</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">{plan.limit}</p>
            <ul className="mt-4 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="text-green-500">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleUpgrade(plan.id)}
              disabled={isCurrent || loading === plan.id}
              className={`mt-6 w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isCurrent
                  ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                  : plan.popular
                    ? "bg-brand-600 text-white hover:bg-brand-700"
                    : "bg-gray-900 text-white hover:bg-gray-800"
              } disabled:opacity-50`}
            >
              {isCurrent ? "Current Plan" : loading === plan.id ? "Redirecting..." : `Upgrade to ${plan.name}`}
            </button>
          </div>
        )
      })}
    </div>
  )
}
