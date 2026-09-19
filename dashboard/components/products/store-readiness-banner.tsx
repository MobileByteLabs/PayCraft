"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw } from "lucide-react"

/**
 * "Can these subscriptions actually be sold?" — read from App Store Connect, not from our own rows.
 *
 * The banner exists because every other surface answered that question with an existence check.
 * `tenant_products.app_store_product_id` being set meant "synced", the unsynced count was 0, and
 * per-product sync returned `ok` — while all three subscriptions sat in `MISSING_METADATA`,
 * unsellable. App Store Connect never says WHICH metadata is missing, so this lists the concrete
 * blockers it can determine (territory price coverage, localization, review screenshot,
 * availability) rather than repeating an opaque state name at the operator.
 *
 * `applicable: false` (App Store not connected) renders nothing: a Stripe-only or Android-only
 * deployment must not be nagged about a store it does not ship to.
 */

interface ProductReadiness {
  store: "app_store" | "google_play"
  sku: string
  productId: string | null
  state: string | null
  ready: boolean
  blockers: string[]
  /** Real but non-blocking: it sells, yet not as configured. Kept visually distinct from blockers. */
  warnings?: string[]
  pricedTerritories?: number
  soldTerritories?: number
  regions?: number
}

interface Payload {
  applicable: boolean
  ready: boolean
  reason?: string
  stores?: Record<string, { applicable: boolean; ready: boolean; reason?: string }>
  products: ProductReadiness[]
}

const STORE_LABEL: Record<string, string> = {
  app_store: "App Store",
  google_play: "Google Play",
}

export function StoreReadinessBanner() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch("/api/products/store-readiness")
      if (!res.ok) throw new Error(String(res.status))
      setData(await res.json())
    } catch {
      // Distinguished from "not ready" on purpose — an unreachable probe is not evidence of a
      // broken product, and reporting it as one sends the operator chasing a phantom.
      setFailed(true)
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm text-ink-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking App Store readiness…
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-ink-100 bg-white px-4 py-3 text-sm text-ink-500">
        <span>Couldn’t check App Store readiness.</span>
        <button onClick={() => void load()} className="inline-flex items-center gap-1.5 text-brand-600 hover:underline">
          <RefreshCcw className="h-3.5 w-3.5" /> Retry
        </button>
      </div>
    )
  }

  if (!data || !data.applicable) return null

  const warned = data.products.filter((p) => (p.warnings ?? []).length > 0)
  const connected = Object.entries(data.stores ?? {})
    .filter(([, v]) => v.applicable)
    .map(([k]) => STORE_LABEL[k] ?? k)

  if (data.ready) {
    // Sellable everywhere it is connected — but warnings still surface. A product that sells in one
    // country while seven are configured is not a problem worth hiding behind a green tick.
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            {connected.join(" + ") || "Stores"}: all {data.products.length} product
            {data.products.length === 1 ? "" : "s"} sellable.
          </span>
        </div>
        {warned.length > 0 ? (
          <ul className="mt-2 space-y-1 border-t border-emerald-200 pt-2">
            {warned.map((p) => (
              <li key={`${p.store}:${p.sku}`} className="text-xs text-emerald-900/80">
                <span className="font-mono">{p.sku}</span>
                <span className="text-emerald-700"> · {STORE_LABEL[p.store] ?? p.store}</span>
                <ul className="ml-4 list-disc">
                  {(p.warnings ?? []).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }

  const blocked = data.products.filter((p) => !p.ready)

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-semibold text-amber-900">
            {blocked.length} product{blocked.length === 1 ? "" : "s"} cannot be sold yet
          </p>
          {data.reason ? <p className="text-xs text-amber-800">{data.reason}</p> : null}
          <ul className="space-y-1.5">
            {blocked.map((p) => (
              <li key={`${p.store}:${p.sku}`} className="text-xs text-amber-900">
                <span className="font-mono font-semibold">{p.sku}</span>
                <span className="text-amber-700"> · {STORE_LABEL[p.store] ?? p.store}</span>
                {p.state ? <span className="text-amber-700"> · {p.state}</span> : null}
                <ul className="ml-4 list-disc text-amber-800">
                  {p.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 hover:underline"
          >
            <RefreshCcw className="h-3.5 w-3.5" /> Re-check
          </button>
        </div>
      </div>
    </div>
  )
}
