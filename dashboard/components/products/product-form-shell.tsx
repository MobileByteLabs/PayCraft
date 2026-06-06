"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  CheckCircle2,
  Info,
  Plus,
  Trash2,
} from "lucide-react"

type ProductType = "subscription" | "trial" | "lifetime"
type Interval = "month" | "quarter" | "semiannual" | "year"

interface ProductInput {
  id?: string
  sku: string
  type: ProductType
  display_name: string
  interval?: Interval | null
  trial_duration_days?: number | null
  attaches_to_product_id?: string | null
  base_price_cents: number
  base_currency: string
  display_order: number
  active: boolean
}

interface Subscription {
  id: string
  sku: string
  display_name: string
  base_price_cents: number
  base_currency: string
  interval: string
}

// Tab labels
const TABS: { id: ProductType; label: string }[] = [
  { id: "subscription", label: "Subscription" },
  { id: "trial", label: "Trial" },
  { id: "lifetime", label: "Lifetime" },
]

const INTERVALS: { value: Interval; label: string; shortLabel: string }[] = [
  { value: "month", label: "Monthly", shortLabel: "/mo" },
  { value: "quarter", label: "Quarterly", shortLabel: "/qtr" },
  { value: "semiannual", label: "Semi-annual", shortLabel: "/6mo" },
  { value: "year", label: "Annual", shortLabel: "/yr" },
]

export function ProductFormShell({
  initial,
  subscriptions,
}: {
  initial: ProductInput
  subscriptions: Subscription[]
}) {
  const router = useRouter()
  const [p, setP] = useState<ProductInput>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [features, setFeatures] = useState<string[]>(["", "", ""])
  const [description, setDescription] = useState("")

  // Derived preview values
  const previewName = p.display_name || "Pro Monthly Plan"
  const previewDesc = description || "The perfect choice for growing teams and scaling startups."
  const previewPrice =
    p.base_price_cents > 0
      ? `$${(p.base_price_cents / 100).toFixed(2)}`
      : "$0.00"
  const intervalObj =
    INTERVALS.find((i) => i.value === (p.interval ?? "month")) ?? INTERVALS[0]
  const previewInterval =
    p.type === "lifetime" ? " one-time" : intervalObj.shortLabel

  const filledFeatures = features.filter((f) => f.trim() !== "")

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const url = p.id ? `/api/products/${p.id}` : "/api/products"
      const method = p.id ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "save failed")
      }
      router.push("/products")
      router.refresh()
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-50">
      {/* Sticky header bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-ink-200 px-8 h-16 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Link
            href="/products"
            className="p-2 hover:bg-ink-100 rounded-lg transition-colors text-ink-500"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-bold text-lg tracking-tight text-ink-900">New product</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-ink-50 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !p.sku || !p.display_name}
            className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 shadow-sm active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating…" : "Create product"}
          </button>
        </div>
      </header>

      <div className="max-w-[1280px] mx-auto p-8">
        {/* Type Tabs */}
        <div className="flex gap-8 mb-8 border-b border-ink-200">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setP({ ...p, type: tab.id })}
              className={`pb-4 text-sm font-semibold transition-colors ${
                p.type === tab.id
                  ? "text-brand-600 border-b-2 border-brand-600"
                  : "text-ink-500 hover:text-ink-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Left Column: Form */}
          <div className="lg:col-span-7 space-y-10">
            {/* Basic Information */}
            <section className="space-y-6">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                  Product name
                </label>
                <input
                  type="text"
                  value={p.display_name}
                  onChange={(e) => setP({ ...p, display_name: e.target.value })}
                  placeholder="e.g. Pro Monthly Plan"
                  className="w-full px-4 py-2.5 bg-white border border-ink-200 rounded-lg text-[14px] transition-all focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                  SKU (used by SDK to identify the plan)
                </label>
                <input
                  type="text"
                  value={p.sku}
                  onChange={(e) => setP({ ...p, sku: e.target.value })}
                  placeholder="e.g. monthly"
                  className="w-full px-4 py-2.5 bg-white border border-ink-200 rounded-lg text-[14px] font-mono transition-all focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe the benefits of this plan..."
                  rows={3}
                  className="w-full px-4 py-2.5 bg-white border border-ink-200 rounded-lg text-[14px] transition-all focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10 resize-none"
                />
              </div>
            </section>

            {/* Pricing & Billing */}
            <section className="p-6 bg-white border border-ink-200 rounded-xl space-y-6">
              {p.type !== "trial" && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                        Base price (cents)
                      </label>
                      <div className="relative">
                        <span className="absolute left-4 top-2.5 text-ink-400 text-sm">¢</span>
                        <input
                          type="number"
                          min={0}
                          value={p.base_price_cents}
                          onChange={(e) =>
                            setP({
                              ...p,
                              base_price_cents: parseInt(e.target.value || "0"),
                            })
                          }
                          placeholder="999"
                          className="w-full pl-8 pr-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-[14px] transition-all focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                        />
                      </div>
                      <p className="text-xs text-ink-400">
                        = {p.base_currency === "INR" ? "₹" : p.base_currency === "USD" ? "$" : ""}
                        {(p.base_price_cents / 100).toFixed(2)} {p.base_currency}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                        Currency (ISO 4217)
                      </label>
                      <select
                        value={p.base_currency}
                        onChange={(e) =>
                          setP({ ...p, base_currency: e.target.value.toUpperCase() })
                        }
                        className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-[14px] transition-all focus:outline-none focus:border-brand-500"
                      >
                        <option value="USD">USD – US Dollar</option>
                        <option value="EUR">EUR – Euro</option>
                        <option value="GBP">GBP – British Pound</option>
                        <option value="INR">INR – Indian Rupee</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {p.type === "subscription" && (
                <div className="space-y-3">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                    Billing interval
                  </label>
                  <div className="flex gap-3">
                    {INTERVALS.map((iv) => (
                      <label
                        key={iv.value}
                        className={`flex-1 flex items-center justify-center p-3 border-2 rounded-xl cursor-pointer transition-all ${
                          (p.interval ?? "month") === iv.value
                            ? "border-brand-600 bg-brand-50"
                            : "border-ink-200 hover:border-ink-300"
                        }`}
                      >
                        <input
                          type="radio"
                          name="interval"
                          value={iv.value}
                          checked={(p.interval ?? "month") === iv.value}
                          onChange={() => setP({ ...p, interval: iv.value })}
                          className="sr-only"
                        />
                        <span
                          className={`text-sm font-semibold ${
                            (p.interval ?? "month") === iv.value
                              ? "text-brand-600"
                              : "text-ink-600"
                          }`}
                        >
                          {iv.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {p.type === "trial" && (
                <>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                      Trial duration (days)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={p.trial_duration_days ?? 7}
                      onChange={(e) =>
                        setP({
                          ...p,
                          trial_duration_days: parseInt(e.target.value),
                        })
                      }
                      className="w-32 px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-[14px] focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                      Converts to subscription
                    </label>
                    <select
                      value={p.attaches_to_product_id ?? ""}
                      onChange={(e) =>
                        setP({
                          ...p,
                          attaches_to_product_id: e.target.value || null,
                        })
                      }
                      className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-[14px] focus:outline-none focus:border-brand-500"
                    >
                      <option value="">— select a subscription —</option>
                      {subscriptions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.display_name} ({(s.base_price_cents / 100).toFixed(2)}{" "}
                          {s.base_currency}/{s.interval})
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {/* Display order & active */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                    Display order
                  </label>
                  <input
                    type="number"
                    value={p.display_order}
                    onChange={(e) =>
                      setP({ ...p, display_order: parseInt(e.target.value) })
                    }
                    className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-[14px] focus:outline-none focus:border-brand-500"
                  />
                </div>
              </div>
            </section>

            {/* Features */}
            <section className="space-y-4">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                Features
              </label>
              <div className="space-y-3">
                {features.map((feat, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={feat}
                      onChange={(e) => {
                        const updated = [...features]
                        updated[i] = e.target.value
                        setFeatures(updated)
                      }}
                      placeholder={
                        i === 0
                          ? "e.g. 24/7 Priority Support"
                          : i === 1
                          ? "e.g. Advanced Analytics"
                          : "e.g. Unlimited API Calls"
                      }
                      className="flex-1 px-4 py-2.5 bg-white border border-ink-200 rounded-lg text-[14px] focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/10"
                    />
                    {features.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setFeatures(features.filter((_, fi) => fi !== i))
                        }
                        className="p-2 text-ink-400 hover:text-danger-600 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFeatures([...features, ""])}
                className="text-sm font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1 mt-2 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add feature
              </button>
            </section>

            {/* Visibility Toggle */}
            <section className="flex items-center justify-between p-4 bg-ink-50/50 border border-ink-200 rounded-xl">
              <div>
                <div className="text-sm font-semibold text-ink-900">Public availability</div>
                <div className="text-xs text-ink-500">
                  Allow customers to discover and subscribe to this product.
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={p.active}
                  onChange={(e) => setP({ ...p, active: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-ink-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600" />
              </label>
            </section>

            {error && (
              <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
                {error}
              </div>
            )}
          </div>

          {/* Right Column: Live Preview */}
          <div className="lg:col-span-5">
            <div className="sticky top-24">
              <div className="text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-4 px-2">
                Paywall Preview
              </div>

              {/* Preview Card */}
              <div className="bg-white border border-ink-200 rounded-2xl shadow-xl overflow-hidden max-w-sm mx-auto transition-all duration-300">
                {/* Header image area */}
                <div className="h-32 bg-ink-900 relative overflow-hidden">
                  <div
                    className="absolute inset-0 opacity-20"
                    style={{
                      backgroundImage:
                        "radial-gradient(circle at 2px 2px, #7C3AED 1px, transparent 0)",
                      backgroundSize: "24px 24px",
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-ink-900 to-transparent" />
                </div>

                <div className="p-8 space-y-6">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold tracking-tight text-ink-900">
                      {previewName}
                    </h3>
                    <p className="text-sm text-ink-500 leading-relaxed">{previewDesc}</p>
                  </div>

                  <div className="flex items-baseline gap-1">
                    <span className="text-3xl font-bold text-ink-900">{previewPrice}</span>
                    <span className="text-ink-500 text-sm">{previewInterval}</span>
                  </div>

                  {filledFeatures.length > 0 && (
                    <div className="space-y-3 pt-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
                        Included features
                      </div>
                      <ul className="space-y-2.5">
                        {filledFeatures.map((feat, i) => (
                          <li key={i} className="flex items-center gap-3 text-[13px]">
                            <CheckCircle2 className="w-4 h-4 text-brand-600 flex-shrink-0" strokeWidth={2} />
                            <span className="text-ink-800">{feat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {filledFeatures.length === 0 && (
                    <div className="space-y-3 pt-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
                        Included features
                      </div>
                      <p className="text-sm text-ink-300 italic">
                        Your features will appear here
                      </p>
                    </div>
                  )}

                  <button
                    type="button"
                    className="w-full py-3 bg-brand-600 text-white font-bold rounded-xl shadow-lg shadow-brand-500/20 hover:bg-brand-700 active:scale-[0.98] transition-all mt-4"
                  >
                    Subscribe now
                  </button>
                  <p className="text-center text-[11px] text-ink-400">
                    Secure payment powered by PayCraft
                  </p>
                </div>
              </div>

              {/* Tip Box */}
              <div className="mt-8 p-4 bg-ink-50 rounded-xl border border-ink-200 flex gap-3">
                <Info className="w-4 h-4 text-ink-400 flex-shrink-0 mt-0.5" />
                <p className="text-[12px] text-ink-600 leading-normal">
                  <span className="font-bold">Pro Tip:</span> Trial periods usually
                  increase conversion by 30%. Consider adding a 7-day trial to your
                  plan.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
