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
  trial_enabled?: boolean
  trial_duration_days?: number | null
  /**
   * Per-platform trial days, e.g. { android: 30, ios: 14, web: 7, desktop: 14 }.
   * A key PRESENT = trial of N days on that platform; a key ABSENT = no trial there.
   * null / empty = no per-platform config (legacy trial_duration_days fallback).
   */
  trial_per_platform?: Record<string, number> | null
  attaches_to_product_id?: string | null
  base_price_cents: number
  base_currency: string
  display_order: number
  active: boolean
  play_product_id?: string | null
  app_store_product_id?: string | null
}

interface Subscription {
  id: string
  sku: string
  display_name: string
  base_price_cents: number
  base_currency: string
  interval: string
}

// Preset trial lengths (days). All are Apple-legal introductory-offer durations, so
// iOS is safe; the same set is valid for Google Play, Stripe, Razorpay & Cashfree.
const TRIAL_PRESETS: { label: string; days: number }[] = [
  { label: "3 days", days: 3 },
  { label: "1 week", days: 7 },
  { label: "2 weeks", days: 14 },
  { label: "1 month", days: 30 },
  { label: "2 months", days: 60 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
]

// The four platforms an operator can configure independently. android→Google Play,
// ios→App Store, web+desktop→the shared web PSP (Stripe/Razorpay/Cashfree).
const TRIAL_PLATFORMS: { key: string; label: string }[] = [
  { key: "android", label: "Android" },
  { key: "ios", label: "iOS" },
  { key: "web", label: "Web" },
  { key: "desktop", label: "Desktop" },
]

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
        body: JSON.stringify(buildPayload(p)),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? "save failed")
      }
      // After editing an existing product land on its View page so the
      // operator sees the updated config + sync panel. After creating, go
      // back to the products list (no view to return to yet).
      router.push(p.id ? `/products/${p.id}` : "/products")
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
          <Field label="Free trial">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={p.trial_enabled ?? true}
                onChange={(e) => setP({ ...p, trial_enabled: e.target.checked })}
              />
              Offer a free trial on first checkout
            </label>
          </Field>
          {(p.trial_enabled ?? true) && (
            <Field label="Trial duration per platform">
              <div className="flex flex-col gap-2">
                {TRIAL_PLATFORMS.map(({ key, label }) => {
                  const map = p.trial_per_platform ?? {}
                  const on = key in map
                  const value = on ? map[key] : 14
                  function setMap(next: Record<string, number>) {
                    setP({ ...p, trial_per_platform: next })
                  }
                  return (
                    <div key={key} className="flex items-center gap-3 text-sm">
                      <label className="flex w-28 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={(e) => {
                            const next = { ...map }
                            if (e.target.checked) next[key] = value
                            else delete next[key]
                            setMap(next)
                          }}
                        />
                        <span className="font-medium text-ink-700">{label}</span>
                      </label>
                      <select
                        value={on ? String(value) : ""}
                        disabled={!on}
                        onChange={(e) =>
                          setMap({ ...map, [key]: parseInt(e.target.value) })
                        }
                        className="input w-40 disabled:opacity-40"
                      >
                        {!on && <option value="">— no trial —</option>}
                        {TRIAL_PRESETS.map((preset) => (
                          <option key={preset.days} value={preset.days}>
                            {preset.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )
                })}
                <p className="text-xs text-ink-500">
                  Web &amp; desktop share one web-checkout trial (Stripe/Razorpay/Cashfree).
                </p>
                <p className="text-xs text-ink-500">
                  Each platform&apos;s trial is stored and synced to that platform&apos;s
                  provider — Android → Google Play, iOS → App Store, Web/Desktop → the web
                  PSP. A platform left unchecked gets no free trial. Changes reflect in the
                  app in realtime.
                </p>
              </div>
            </Field>
          )}
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

      <fieldset className="space-y-3 rounded border border-gray-200 p-4">
        <legend className="px-1 text-sm font-semibold text-gray-700">
          Store product IDs (native billing)
        </legend>
        <p className="text-xs text-gray-500">
          Required for Google Play Billing on Android / StoreKit on iOS. Leave
          blank if this product is sold only through payment links.
        </p>
        <Field label="Google Play product ID">
          <input
            value={p.play_product_id ?? ""}
            onChange={(e) =>
              setP({ ...p, play_product_id: e.target.value || null })
            }
            placeholder="e.g. premium_monthly"
            className="input"
          />
        </Field>
        <Field label="App Store product ID">
          <input
            value={p.app_store_product_id ?? ""}
            onChange={(e) =>
              setP({ ...p, app_store_product_id: e.target.value || null })
            }
            placeholder="e.g. com.acme.premium.monthly"
            className="input"
          />
        </Field>
      </fieldset>

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
        {/*
          D6 disclosure, placed immediately under the control rather than in a help page.
          "Disable" and "revoke" are different operations and a merchant who confuses them is
          performing a refund by accident — so the guarantee is stated where the decision is made.
          Migration 090 is what makes this true rather than aspirational: the entitlement read
          path never joins tenant_products.active, so there is no code path by which this
          checkbox can withdraw access someone paid for.
        */}
        <p className="mt-2 text-sm text-ink-500" data-testid="product-active-d6-copy">
          Disabling hides this product from the paywall. Anyone who already purchased keeps their
          entitlement — <strong>disabling never revokes access</strong>. Lifetime purchases are
          honoured indefinitely.
        </p>
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

/**
 * Shape the outgoing product payload. For subscriptions, the per-platform trial map
 * is only sent when the master "Offer a free trial" toggle is ON (otherwise null, so a
 * stale map can never keep syncing trials the operator turned off). A legacy
 * `trial_duration_days` is set to the iOS value (or the first present platform) so
 * older consumers of that single field keep working.
 */
function buildPayload(p: ProductInput): ProductInput {
  if (p.type !== "subscription") return p
  const map = p.trial_enabled ? (p.trial_per_platform ?? {}) : null
  const hasKeys = map && Object.keys(map).length > 0
  const legacy = hasKeys ? (map!.ios ?? Object.values(map!)[0] ?? null) : null
  return {
    ...p,
    trial_per_platform: hasKeys ? map : null,
    trial_duration_days: legacy ?? p.trial_duration_days ?? null,
  }
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
