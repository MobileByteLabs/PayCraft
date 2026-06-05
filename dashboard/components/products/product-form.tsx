"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

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

export function ProductForm({
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
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      className="max-w-xl space-y-5"
    >
      <Field label="Product type">
        <select
          value={p.type}
          onChange={(e) =>
            setP({ ...p, type: e.target.value as ProductType })
          }
          className="input"
        >
          <option value="subscription">Subscription (recurring)</option>
          <option value="trial">Trial (free for N days then converts)</option>
          <option value="lifetime">Lifetime (one-time payment)</option>
        </select>
      </Field>

      <Field label="SKU (used by SDK to identify the plan)">
        <input
          value={p.sku}
          onChange={(e) => setP({ ...p, sku: e.target.value })}
          required
          placeholder="monthly"
          className="input"
        />
      </Field>

      <Field label="Display name">
        <input
          value={p.display_name}
          onChange={(e) => setP({ ...p, display_name: e.target.value })}
          required
          placeholder="Monthly Premium"
          className="input"
        />
      </Field>

      {p.type === "subscription" && (
        <>
          <Field label="Interval">
            <select
              value={p.interval ?? "month"}
              onChange={(e) => setP({ ...p, interval: e.target.value as Interval })}
              className="input"
            >
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="semiannual">Semi-annual</option>
              <option value="year">Year</option>
            </select>
          </Field>
          <PriceFields p={p} setP={setP} />
        </>
      )}

      {p.type === "trial" && (
        <>
          <Field label="Trial duration (days)">
            <input
              type="number"
              min={1}
              max={365}
              value={p.trial_duration_days ?? 7}
              onChange={(e) =>
                setP({ ...p, trial_duration_days: parseInt(e.target.value) })
              }
              className="input"
            />
          </Field>
          <Field label="Converts to subscription">
            <select
              value={p.attaches_to_product_id ?? ""}
              onChange={(e) =>
                setP({ ...p, attaches_to_product_id: e.target.value || null })
              }
              className="input"
            >
              <option value="">— select a subscription —</option>
              {subscriptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name} ({(s.base_price_cents / 100).toFixed(2)}{" "}
                  {s.base_currency}/{s.interval})
                </option>
              ))}
            </select>
          </Field>
        </>
      )}

      {p.type === "lifetime" && <PriceFields p={p} setP={setP} />}

      <Field label="Display order">
        <input
          type="number"
          value={p.display_order}
          onChange={(e) =>
            setP({ ...p, display_order: parseInt(e.target.value) })
          }
          className="input w-24"
        />
      </Field>

      <Field label="Active">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={p.active}
            onChange={(e) => setP({ ...p, active: e.target.checked })}
          />
          Show in paywall
        </label>
      </Field>

      {error && (
        <div className="rounded bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-brand-600 text-white px-5 py-2 text-sm font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save product"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded border border-gray-300 px-5 py-2 text-sm text-gray-700"
        >
          Cancel
        </button>
      </div>

      <style jsx>{`
        :global(.input) {
          border: 1px solid #d1d5db;
          border-radius: 0.5rem;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          width: 100%;
        }
        :global(.input:focus) {
          outline: 2px solid #9d7fff;
          border-color: transparent;
        }
      `}</style>
    </form>
  )
}

function PriceFields({
  p,
  setP,
}: {
  p: ProductInput
  setP: (v: ProductInput) => void
}) {
  return (
    <>
      <Field label="Base price (in cents/minor units)">
        <input
          type="number"
          min={0}
          value={p.base_price_cents}
          onChange={(e) =>
            setP({ ...p, base_price_cents: parseInt(e.target.value || "0") })
          }
          className="input"
        />
        <p className="text-xs text-gray-500 mt-1">
          {(p.base_price_cents / 100).toFixed(2)} {p.base_currency} — used when
          no per-locale override is set
        </p>
      </Field>
      <Field label="Base currency (ISO 4217)">
        <input
          value={p.base_currency}
          onChange={(e) =>
            setP({ ...p, base_currency: e.target.value.toUpperCase() })
          }
          maxLength={3}
          className="input w-24"
        />
      </Field>
    </>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
