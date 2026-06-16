"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Plus, Tag, Trash2, X } from "lucide-react"

type Duration = "once" | "repeating" | "forever"

interface Coupon {
  id: string
  code: string
  name: string | null
  percent_off: number
  duration: Duration
  duration_in_months: number | null
  max_redemptions: number | null
  redeem_by: string | null
  applies_to_product_ids: string[]
  times_redeemed: number
  active: boolean
  created_at: string
}

interface ProductRef {
  id: string
  sku: string
  display_name: string
  interval: string | null
}

export function CouponsManager({
  initialCoupons,
  products,
}: {
  initialCoupons: Coupon[]
  products: ProductRef[]
}) {
  const router = useRouter()
  const [coupons, setCoupons] = useState<Coupon[]>(initialCoupons)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    code: string
    name: string
    percent_off: number
    duration: Duration
    duration_in_months: number | null
    max_redemptions: number | null
    redeem_by: string
    applies_to_product_ids: string[]
  }>({
    code: "",
    name: "",
    percent_off: 25,
    duration: "once",
    duration_in_months: null,
    max_redemptions: null,
    redeem_by: "",
    applies_to_product_ids: [],
  })
  const [showForm, setShowForm] = useState(false)

  async function save() {
    setCreating(true)
    setError(null)
    try {
      const res = await fetch("/api/coupons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...draft,
          redeem_by: draft.redeem_by ? new Date(draft.redeem_by).toISOString() : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "save failed")
      const refresh = await fetch("/api/coupons")
      const refreshed = await refresh.json()
      setCoupons(refreshed.coupons ?? [])
      setShowForm(false)
      setDraft({
        code: "",
        name: "",
        percent_off: 25,
        duration: "once",
        duration_in_months: null,
        max_redemptions: null,
        redeem_by: "",
        applies_to_product_ids: [],
      })
      router.refresh()
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setCreating(false)
    }
  }

  async function deactivate(id: string) {
    if (!confirm("Deactivate this coupon? Existing redemptions stay intact.")) return
    const res = await fetch(`/api/coupons/${id}`, { method: "DELETE" })
    if (res.ok) {
      setCoupons((prev) => prev.filter((c) => c.id !== id))
      router.refresh()
    }
  }

  return (
    <div>
      <div className="mb-8 pt-10 flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-ink-900 tracking-tight flex items-center gap-3">
            <Tag className="w-6 h-6 text-brand-600" />
            Coupons
          </h2>
          <p className="text-sm text-ink-500 mt-1">
            Code-based discounts your customers type at checkout. Recurring
            subscriptions continue automatically — Stripe applies the discount
            for the duration you set.
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 shadow-sm active:scale-[0.98] transition-all flex items-center gap-2"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? "Cancel" : "New coupon"}
        </button>
      </div>

      {showForm && (
        <div className="mb-8 p-8 bg-white border border-ink-200 rounded-xl space-y-6">
          <h3 className="text-lg font-bold text-ink-900">Create coupon</h3>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                Code (customer-typed)
              </label>
              <input
                value={draft.code}
                onChange={(e) =>
                  setDraft({ ...draft, code: e.target.value.toUpperCase().replace(/\s+/g, "") })
                }
                placeholder="WELCOME25"
                className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm font-mono uppercase focus:outline-none focus:border-brand-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                Display name (optional)
              </label>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Launch week"
                className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                Percent off
              </label>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={draft.percent_off}
                  onChange={(e) =>
                    setDraft({ ...draft, percent_off: parseInt(e.target.value || "25") })
                  }
                  className="w-full pl-4 pr-10 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                />
                <span className="absolute right-4 top-2.5 text-ink-400">%</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                Duration
              </label>
              <select
                value={draft.duration}
                onChange={(e) => {
                  const next = e.target.value as Duration
                  setDraft({
                    ...draft,
                    duration: next,
                    duration_in_months: next === "repeating" ? draft.duration_in_months ?? 3 : null,
                  })
                }}
                className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
              >
                <option value="once">Once — first invoice only</option>
                <option value="repeating">Repeating — N months then drops off</option>
                <option value="forever">Forever — every invoice</option>
              </select>
            </div>
            {draft.duration === "repeating" && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                  Months
                </label>
                <input
                  type="number"
                  min={1}
                  max={36}
                  value={draft.duration_in_months ?? 3}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      duration_in_months: parseInt(e.target.value || "3"),
                    })
                  }
                  className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                Expires at (optional)
              </label>
              <input
                type="datetime-local"
                value={draft.redeem_by}
                onChange={(e) => setDraft({ ...draft, redeem_by: e.target.value })}
                className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
                Max redemptions (optional)
              </label>
              <input
                type="number"
                min={1}
                value={draft.max_redemptions ?? ""}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_redemptions: e.target.value ? parseInt(e.target.value) : null,
                  })
                }
                placeholder="unlimited"
                className="w-full px-4 py-2.5 bg-ink-50/50 border border-ink-200 rounded-lg text-sm focus:outline-none focus:border-brand-500"
              />
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-[11px] font-bold uppercase tracking-wider text-ink-500 block">
              Applies to (leave empty for all products)
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto p-3 bg-ink-50/50 border border-ink-200 rounded-lg">
              {products.length === 0 && (
                <p className="text-xs text-ink-400 italic col-span-2">
                  No products yet — create some first, then come back.
                </p>
              )}
              {products.map((p) => {
                const selected = draft.applies_to_product_ids.includes(p.id)
                return (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-all ${
                      selected
                        ? "bg-brand-50 border border-brand-200 text-brand-900"
                        : "bg-white border border-ink-200 hover:border-ink-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setDraft({
                            ...draft,
                            applies_to_product_ids: [...draft.applies_to_product_ids, p.id],
                          })
                        } else {
                          setDraft({
                            ...draft,
                            applies_to_product_ids: draft.applies_to_product_ids.filter(
                              (x) => x !== p.id,
                            ),
                          })
                        }
                      }}
                    />
                    <span className="flex-1">{p.display_name}</span>
                    <span className="text-[10px] font-mono text-ink-400">{p.sku}</span>
                  </label>
                )
              })}
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-ink-50 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={creating || !draft.code.trim() || !draft.percent_off}
              className="px-4 py-2 text-sm font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {creating ? "Creating…" : "Create coupon"}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white border border-ink-200 rounded-xl overflow-hidden">
        {coupons.length === 0 ? (
          <div className="p-12 text-center">
            <Tag className="w-10 h-10 text-ink-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-ink-700 mb-1">No coupons yet</h3>
            <p className="text-xs text-ink-500">
              Create one to give customers a discount code at checkout. Stripe handles
              the recurring application automatically.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-ink-50 border-b border-ink-100">
              <tr className="text-left text-[11px] uppercase tracking-wider text-ink-500 font-bold">
                <th className="px-6 py-3">Code</th>
                <th className="px-6 py-3">Discount</th>
                <th className="px-6 py-3">Duration</th>
                <th className="px-6 py-3">Applies to</th>
                <th className="px-6 py-3">Redemptions</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {coupons.map((c) => {
                const expired =
                  c.redeem_by !== null && new Date(c.redeem_by) <= new Date()
                const exhausted =
                  c.max_redemptions !== null && c.times_redeemed >= c.max_redemptions
                const status = !c.active
                  ? { label: "Inactive", className: "bg-ink-100 text-ink-600" }
                  : expired
                    ? { label: "Expired", className: "bg-warning-100 text-warning-800" }
                    : exhausted
                      ? { label: "Exhausted", className: "bg-warning-100 text-warning-800" }
                      : { label: "Active", className: "bg-success-100 text-success-800" }
                return (
                  <tr key={c.id} className="hover:bg-ink-50/50">
                    <td className="px-6 py-3 font-mono font-bold text-ink-900">{c.code}</td>
                    <td className="px-6 py-3 text-ink-700">{c.percent_off}% off</td>
                    <td className="px-6 py-3 text-ink-500">
                      {c.duration === "once"
                        ? "Once"
                        : c.duration === "repeating"
                          ? `${c.duration_in_months}mo`
                          : "Forever"}
                    </td>
                    <td className="px-6 py-3 text-ink-500">
                      {c.applies_to_product_ids.length === 0
                        ? "All products"
                        : `${c.applies_to_product_ids.length} product${c.applies_to_product_ids.length === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-6 py-3 text-ink-700 font-mono text-xs">
                      {c.times_redeemed}
                      {c.max_redemptions !== null && ` / ${c.max_redemptions}`}
                    </td>
                    <td className="px-6 py-3">
                      <span
                        className={`px-2 py-1 rounded-full text-[10px] uppercase tracking-wider font-bold ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {c.active && (
                        <button
                          onClick={() => deactivate(c.id)}
                          className="p-2 text-ink-400 hover:text-danger-600 hover:bg-danger-50 rounded transition-colors"
                          title="Deactivate"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
