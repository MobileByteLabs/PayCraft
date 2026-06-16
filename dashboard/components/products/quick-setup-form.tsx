"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Check, CheckCircle2, Loader2, Sparkles, Zap } from "lucide-react"
import { resolveTemplatePrices } from "@/lib/pricing-template"

type ProductType = "subscription" | "lifetime"

interface Plan {
  id: string             // form-internal id
  enabled: boolean
  label: string
  shortLabel: string
  interval: "month" | "quarter" | "semiannual" | "year" | null
  months: number         // 0 for lifetime
  defaultDiscount: number // % off monthly-equivalent. e.g. 0.17 = 17% off
  sku: string            // auto-suggested, user-editable
  priceCents: number     // per-period price, derived from monthly × months × (1 - discount)
  trialEnabled: boolean
  trialDays: number
}

const DEFAULT_PLANS: Plan[] = [
  { id: "monthly",    enabled: true,  label: "Monthly",     shortLabel: "/mo",  interval: "month",      months: 1,  defaultDiscount: 0,    sku: "monthly",    priceCents: 999, trialEnabled: true, trialDays: 7 },
  { id: "quarterly",  enabled: false, label: "Quarterly",   shortLabel: "/qtr", interval: "quarter",    months: 3,  defaultDiscount: 0.05, sku: "quarterly",  priceCents: 0,   trialEnabled: true, trialDays: 7 },
  { id: "semiannual", enabled: false, label: "Semi-annual", shortLabel: "/6mo", interval: "semiannual", months: 6,  defaultDiscount: 0.10, sku: "semiannual", priceCents: 0,   trialEnabled: true, trialDays: 14 },
  { id: "annual",     enabled: true,  label: "Annual",      shortLabel: "/yr",  interval: "year",       months: 12, defaultDiscount: 0.17, sku: "annual",     priceCents: 0,   trialEnabled: true, trialDays: 14 },
  { id: "lifetime",   enabled: false, label: "Lifetime",    shortLabel: " one-time", interval: null,    months: 0,  defaultDiscount: 0,    sku: "lifetime",   priceCents: 0,   trialEnabled: false, trialDays: 0 },
]

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "AUD"]

function scaledPriceCents(monthlyCents: number, months: number, discount: number): number {
  // Lifetime: default to 12x monthly (= 1 year) as a sensible starting point.
  const factor = months === 0 ? 12 : months
  return Math.round(monthlyCents * factor * (1 - discount))
}

export function QuickSetupForm() {
  const router = useRouter()
  const [skuBase, setSkuBase] = useState("pro")
  const [nameBase, setNameBase] = useState("Pro")
  const [monthlyCents, setMonthlyCents] = useState(999)
  const [currency, setCurrency] = useState("USD")
  const [plans, setPlans] = useState<Plan[]>(DEFAULT_PLANS)
  // Default trial config applied to every plan unless that plan opts to override.
  const [defaultTrialEnabled, setDefaultTrialEnabled] = useState(true)
  const [defaultTrialDays, setDefaultTrialDays] = useState(7)
  const [trialOverrides, setTrialOverrides] = useState<Record<string, boolean>>({})
  // Promotional discount applied to every selected plan uniformly.
  const [discountPercent, setDiscountPercent] = useState<number | null>(null)
  const [discountEndsAt, setDiscountEndsAt] = useState<string>("")
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Derive each enabled plan's price from monthly + months + discount whenever those change.
  useEffect(() => {
    setPlans((prev) =>
      prev.map((p) => ({
        ...p,
        priceCents: scaledPriceCents(monthlyCents, p.months, p.defaultDiscount),
        sku: `${skuBase}-${p.id}`.replace(/^-/, ""),
      })),
    )
  }, [monthlyCents, skuBase])

  const enabledPlans = plans.filter((p) => p.enabled)

  // Per-country preview for the cheapest enabled plan — gives the user a feel for
  // how the multi-currency template will shake out before they batch-create.
  const previewPlan = enabledPlans[0]
  const countryPreview = useMemo(
    () => (previewPlan ? resolveTemplatePrices(previewPlan.priceCents).slice(0, 6) : []),
    [previewPlan?.priceCents],
  )

  function togglePlan(id: string) {
    setPlans((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
    )
  }

  function updatePlan(id: string, patch: Partial<Plan>) {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  async function createAll() {
    if (!enabledPlans.length) {
      setError("Select at least one plan.")
      return
    }
    if (!skuBase.trim() || !nameBase.trim()) {
      setError("SKU prefix and display name are required.")
      return
    }
    setCreating(true)
    setError(null)
    setCreated(0)

    let failed: string | null = null
    for (let i = 0; i < enabledPlans.length; i++) {
      const plan = enabledPlans[i]
      const type: ProductType = plan.months === 0 ? "lifetime" : "subscription"
      const pricingRows = resolveTemplatePrices(plan.priceCents).map((r) => ({
        locale: r.country,
        currency: r.currency,
        amount_cents: r.amountCents,
        source: "stripe",
      }))
      // Resolve trial — per-plan override wins; otherwise use the global default.
      const isOverridden = trialOverrides[plan.id] === true
      const effectiveTrialEnabled = isOverridden ? plan.trialEnabled : defaultTrialEnabled
      const effectiveTrialDays    = isOverridden ? plan.trialDays    : defaultTrialDays
      const body = {
        sku: plan.sku,
        type,
        display_name: `${nameBase} ${plan.label}`,
        interval: plan.interval,
        trial_enabled: effectiveTrialEnabled,
        trial_duration_days: effectiveTrialEnabled ? effectiveTrialDays : null,
        attaches_to_product_id: null,
        base_price_cents: plan.priceCents,
        base_currency: currency,
        pricing_mode: "auto",
        global_price_cents: null,
        global_currency: null,
        display_order: i,
        active: true,
        // Uniform percentage discount across every plan (promotional, no code).
        discount_percent: discountPercent,
        discount_ends_at: discountEndsAt ? new Date(discountEndsAt).toISOString() : null,
        pricing_rows: pricingRows,
      }
      const res = await fetch("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        failed = await res
          .json()
          .then((b) => b.error)
          .catch(() => `Failed creating ${plan.label}`)
        break
      }
      setCreated(i + 1)
    }

    if (failed) {
      setError(failed)
      setCreating(false)
      return
    }
    router.push("/products")
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Sticky header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-ink-200 px-8 h-16 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link
            href="/products"
            className="p-2 hover:bg-ink-100 rounded-lg transition-colors text-ink-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-bold text-lg tracking-tight text-ink-900">Quick setup</h1>
          <span className="px-2 py-0.5 rounded-full bg-brand-50 border border-brand-200 text-[11px] font-semibold text-brand-700 flex items-center gap-1">
            <Zap className="w-3 h-3" /> Batch create
          </span>
        </div>
        <button
          onClick={createAll}
          disabled={creating || !enabledPlans.length}
          className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 shadow-sm active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {creating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Creating {created}/{enabledPlans.length}…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Create {enabledPlans.length} product{enabledPlans.length === 1 ? "" : "s"}
            </>
          )}
        </button>
      </header>

      <div className="max-w-[1280px] mx-auto p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left — form */}
          <div className="lg:col-span-7 space-y-8">
            {/* Common identity */}
            <section className="space-y-6 p-6 bg-white border border-ink-200 rounded-xl">
              <div>
                <h3 className="text-sm font-bold text-ink-900">Product identity</h3>
                <p className="text-xs text-ink-500 mt-1">
                  Shared across every plan you create below.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                    SKU prefix
                  </label>
                  <input
                    value={skuBase}
                    onChange={(e) => setSkuBase(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                    placeholder="pro"
                    className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
                  />
                  <p className="text-xs text-ink-400">Each plan becomes {`{prefix}-{interval}`}.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                    Display name
                  </label>
                  <input
                    value={nameBase}
                    onChange={(e) => setNameBase(e.target.value)}
                    placeholder="Pro"
                    className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                  />
                  <p className="text-xs text-ink-400">Each plan becomes "Pro Monthly" / "Pro Annual" / etc.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                    Monthly base price (cents)
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-2.5 text-ink-400 text-sm">¢</span>
                    <input
                      type="number"
                      min={0}
                      value={monthlyCents}
                      onChange={(e) => setMonthlyCents(parseInt(e.target.value || "0"))}
                      placeholder="999"
                      className="w-full pl-8 pr-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <p className="text-xs text-ink-400">
                    = {currency === "INR" ? "₹" : currency === "USD" ? "$" : ""}
                    {(monthlyCents / 100).toFixed(2)} {currency} per month — longer plans scale from this.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                    Currency
                  </label>
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </section>

            {/* Default trial — applies to every plan unless overridden */}
            <section className="space-y-4 p-6 bg-white border border-ink-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-ink-900">Free trial</h3>
                  <p className="text-xs text-ink-500 mt-1">
                    One trial config applied to every plan below. Each plan can
                    override individually if you want a longer trial on annual.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={defaultTrialEnabled}
                    onChange={(e) => setDefaultTrialEnabled(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-ink-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600" />
                </label>
              </div>
              {defaultTrialEnabled && (
                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500">
                    Duration (days)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={defaultTrialDays}
                    onChange={(e) => setDefaultTrialDays(parseInt(e.target.value || "7"))}
                    className="w-24 px-3 py-2 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                  />
                </div>
              )}
            </section>

            {/* Promotional discount — same % applied to every plan */}
            <section className="space-y-4 p-6 bg-white border border-ink-200 rounded-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-ink-900">Promotional discount</h3>
                  <p className="text-xs text-ink-500 mt-1">
                    Uniform percentage off every plan. The paywall renders the
                    original price strike-through + the discounted final amount.
                    No code required — applies to every checkout automatically.
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={discountPercent !== null}
                    onChange={(e) => setDiscountPercent(e.target.checked ? 20 : null)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-ink-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600" />
                </label>
              </div>
              {discountPercent !== null && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                      Percent off
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        min={1}
                        max={99}
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(parseInt(e.target.value || "20"))}
                        className="w-full pl-4 pr-10 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                      />
                      <span className="absolute right-4 top-2.5 text-ink-400 text-sm">%</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                      Ends at (optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={discountEndsAt}
                      onChange={(e) => setDiscountEndsAt(e.target.value)}
                      className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                    />
                    <p className="text-xs text-ink-400">Leave blank for no expiry.</p>
                  </div>
                </div>
              )}
            </section>

            {/* Plan matrix */}
            <section className="space-y-3">
              <div>
                <h3 className="text-sm font-bold text-ink-900">Plans to create</h3>
                <p className="text-xs text-ink-500 mt-1">
                  Pick the intervals you want. Each one becomes a separate product synced to your provider.
                </p>
              </div>
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    plan.enabled
                      ? "border-brand-500 bg-brand-50/30"
                      : "border-ink-200 bg-white"
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => togglePlan(plan.id)}
                      className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 ${
                        plan.enabled
                          ? "border-brand-600 bg-brand-600 text-white"
                          : "border-ink-300 bg-white"
                      }`}
                    >
                      {plan.enabled && <Check className="w-3 h-3" strokeWidth={3} />}
                    </button>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-ink-900">{plan.label}</span>
                        <span className="text-xs font-mono text-ink-400">{plan.sku}</span>
                      </div>
                      {plan.enabled && (
                        <div className="flex items-center gap-4 mt-2">
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                              Price (¢)
                            </label>
                            <input
                              type="number"
                              min={0}
                              value={plan.priceCents}
                              onChange={(e) =>
                                updatePlan(plan.id, { priceCents: parseInt(e.target.value || "0") })
                              }
                              className="w-24 px-2 py-1 bg-white border border-ink-200 rounded text-xs focus:outline-none focus:border-brand-500"
                            />
                            <span className="text-xs text-ink-500">
                              = {currency === "INR" ? "₹" : currency === "USD" ? "$" : ""}
                              {(plan.priceCents / 100).toFixed(2)} {currency}
                              {plan.shortLabel}
                            </span>
                          </div>
                          {plan.months > 1 && (
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] uppercase tracking-wider text-ink-500 font-bold">
                                Discount
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={80}
                                step={1}
                                value={Math.round(plan.defaultDiscount * 100)}
                                onChange={(e) => {
                                  const next = parseInt(e.target.value || "0") / 100
                                  updatePlan(plan.id, {
                                    defaultDiscount: next,
                                    priceCents: scaledPriceCents(monthlyCents, plan.months, next),
                                  })
                                }}
                                className="w-14 px-2 py-1 bg-white border border-ink-200 rounded text-xs focus:outline-none focus:border-brand-500"
                              />
                              <span className="text-xs text-ink-500">% off monthly × {plan.months}</span>
                            </div>
                          )}
                          {plan.interval && (
                            <div className="flex items-center gap-2">
                              <label className="text-[10px] uppercase tracking-wider text-ink-500 font-bold flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={trialOverrides[plan.id] === true}
                                  onChange={(e) =>
                                    setTrialOverrides((prev) => ({
                                      ...prev,
                                      [plan.id]: e.target.checked,
                                    }))
                                  }
                                />
                                Override trial
                              </label>
                              {trialOverrides[plan.id] === true ? (
                                <>
                                  <input
                                    type="checkbox"
                                    checked={plan.trialEnabled}
                                    onChange={(e) =>
                                      updatePlan(plan.id, { trialEnabled: e.target.checked })
                                    }
                                  />
                                  {plan.trialEnabled && (
                                    <>
                                      <input
                                        type="number"
                                        min={1}
                                        max={365}
                                        value={plan.trialDays}
                                        onChange={(e) =>
                                          updatePlan(plan.id, {
                                            trialDays: parseInt(e.target.value || "7"),
                                          })
                                        }
                                        className="w-14 px-2 py-1 bg-white border border-ink-200 rounded text-xs focus:outline-none focus:border-brand-500"
                                      />
                                      <span className="text-xs text-ink-500">days</span>
                                    </>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-ink-400 italic">
                                  uses default ({defaultTrialEnabled ? `${defaultTrialDays}d` : "none"})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>

            {error && (
              <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
                {error}
              </div>
            )}
          </div>

          {/* Right — preview */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 space-y-4">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-400 px-2">
                Plans to be created
              </div>
              <div className="bg-white rounded-2xl border border-ink-200 shadow-sm overflow-hidden">
                <div className="p-6 space-y-3">
                  {enabledPlans.length === 0 ? (
                    <p className="text-sm text-ink-500 italic text-center py-6">
                      No plans selected — tick a box on the left to preview.
                    </p>
                  ) : (
                    enabledPlans.map((plan) => (
                      <div
                        key={plan.id}
                        className="flex items-center justify-between border border-ink-100 rounded-lg px-4 py-3"
                      >
                        <div>
                          <div className="text-sm font-bold text-ink-900">
                            {nameBase} {plan.label}
                          </div>
                          <div className="text-[11px] font-mono text-ink-400">{plan.sku}</div>
                        </div>
                        <div className="text-right">
                          {discountPercent !== null && discountPercent > 0 ? (
                            <>
                              <div className="text-xs text-ink-400 line-through">
                                {currency === "USD" ? "$" : currency === "INR" ? "₹" : ""}
                                {(plan.priceCents / 100).toFixed(2)}
                              </div>
                              <div className="text-sm font-bold text-success-700">
                                {currency === "USD" ? "$" : currency === "INR" ? "₹" : ""}
                                {((plan.priceCents * (100 - discountPercent)) / 10000).toFixed(2)}
                                <span className="text-xs text-success-700/70 ml-1">
                                  {plan.shortLabel}
                                </span>
                              </div>
                              <div className="text-[9px] font-bold text-success-700 uppercase tracking-wider">
                                {discountPercent}% off
                              </div>
                            </>
                          ) : (
                            <div className="text-sm font-bold text-ink-900">
                              {currency === "USD" ? "$" : currency === "INR" ? "₹" : ""}
                              {(plan.priceCents / 100).toFixed(2)}
                              <span className="text-xs text-ink-500 ml-1">{plan.shortLabel}</span>
                            </div>
                          )}
                          {(trialOverrides[plan.id] ? plan.trialEnabled : defaultTrialEnabled) && (
                            <div className="text-[10px] text-brand-600 font-semibold">
                              {trialOverrides[plan.id] ? plan.trialDays : defaultTrialDays}d trial
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                {previewPlan && (
                  <div className="p-6 bg-ink-50 border-t border-ink-100">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-ink-400 mb-3">
                      Multi-currency preview · {previewPlan.label}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {countryPreview.map((c) => (
                        <div
                          key={c.country}
                          className="bg-white px-3 py-2 rounded border border-ink-200"
                        >
                          <div className="text-[10px] text-ink-400 font-bold">{c.country}</div>
                          <div className="text-ink-700 font-mono">
                            {c.currency} {(c.amountCents / 100).toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="bg-brand-50 rounded-xl border border-brand-100 p-4 flex gap-3">
                <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-brand-800 leading-relaxed">
                  Each plan creates its own Stripe Product + Price + Payment Link
                  (and Razorpay Plan if connected) so consumers see the right
                  recurrence on checkout.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
