"use client"

import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useActiveTenant, LoadingRows, LoadError } from "@/components/dashboard/account-queries"

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

/** The upgrade page body: the active app's plan (read in the browser) + the plan cards. */
export function UpgradeView() {
  const tenantQuery = useActiveTenant()
  const tenant = tenantQuery.data
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink-900 mb-2">Upgrade Plan</h1>
      {tenantQuery.isPending ? (
        <div className="mb-8 rounded-xl border border-ink-200 bg-white">
          <LoadingRows label="Loading your plan…" rows={1} />
        </div>
      ) : tenantQuery.isError ? (
        <div className="mb-8 rounded-xl border border-ink-200 bg-white">
          <LoadError what="your plan" error={tenantQuery.error} onRetry={() => void tenantQuery.refetch()} />
        </div>
      ) : (
        <>
          <p className="text-ink-500 mb-8">
            Current plan: <span className="font-medium capitalize">{tenant!.plan}</span>
            {" "}({tenant!.subscriber_limit.toLocaleString()} subscribers)
          </p>
          <UpgradeCards currentPlan={tenant!.plan} tenantId={tenant!.id} />
        </>
      )}
    </div>
  )
}

export function UpgradeCards({
  currentPlan,
  tenantId,
}: {
  currentPlan: string
  tenantId: string
}) {
  const checkout = useMutation({
    mutationFn: async (planId: string) => {
      const res = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, tenant_id: tenantId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!data.url) throw new Error(data.error || "Failed to create checkout session")
      return data.url as string
    },
    // Leaving for Stripe Checkout — the button keeps its "Redirecting..." state until the page unloads.
    onSuccess: (url) => {
      window.location.href = url
    },
  })
  // Pending, or succeeded and navigating away.
  const loading = checkout.isPending || checkout.isSuccess ? checkout.variables : null

  function handleUpgrade(planId: string) {
    if (planId === "free" || planId === currentPlan || loading) return
    checkout.mutate(planId)
  }

  return (
    <>
    {checkout.isError && (
      <div role="alert" className="mb-6 rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
        {checkout.error.message}
      </div>
    )}
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {plans.map((plan) => {
        const isCurrent = plan.id === currentPlan
        return (
          <div
            key={plan.id}
            className={`relative rounded-xl border-2 p-6 ${
              plan.popular
                ? "border-brand-500 shadow-lg"
                : "border-ink-200"
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
              <span className="text-ink-500">{plan.period}</span>
            </div>
            <p className="mt-1 text-sm text-ink-500">{plan.limit}</p>
            <ul className="mt-4 space-y-2">
              {plan.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-ink-600">
                  <span className="text-green-500">&#10003;</span> {f}
                </li>
              ))}
            </ul>
            <button
              onClick={() => handleUpgrade(plan.id)}
              disabled={isCurrent || loading === plan.id}
              className={`mt-6 w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${
                isCurrent
                  ? "bg-ink-100 text-ink-400 cursor-not-allowed"
                  : plan.popular
                    ? "bg-brand-600 text-white hover:bg-brand-700"
                    : "bg-ink-900 text-white hover:bg-ink-800"
              } disabled:opacity-50`}
            >
              {loading === plan.id && <Loader2 className="mr-2 inline w-4 h-4 animate-spin" />}
              {isCurrent ? "Current Plan" : loading === plan.id ? "Redirecting..." : `Upgrade to ${plan.name}`}
            </button>
          </div>
        )
      })}
    </div>
    </>
  )
}
