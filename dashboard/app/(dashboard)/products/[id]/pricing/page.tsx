"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Save } from "lucide-react"
import {
  LocaleMatrix,
  type PricingMap,
  type PricingRowState,
} from "@/components/pricing/locale-matrix"

/**
 * Locale-pricing matrix editor — AC-32. Reads existing tenant_pricing
 * rows for the product, lets the user override the shipped template
 * per-country, and bulk-upserts via `tenant_pricing_bulk_upsert` on Save.
 */
export default function PricingMatrixPage() {
  const params = useParams<{ id: string }>()
  const productId = params.id

  const [product, setProduct] = useState<{
    id: string
    display_name: string
    sku: string
    base_price_cents: number
    base_currency: string
  } | null>(null)
  const [rows, setRows] = useState<PricingMap>({})
  // Distinguishing "failed to load" from "still loading" is what makes the stub unnecessary:
  // previously the page had only a null-product state, so a fetch failure rendered the loading
  // spinner forever and the placeholder row was the compensating hack.
  const [loadError, setLoadError] = useState<{ status: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const [productRes, pricingRes] = await Promise.all([
        fetch(`/api/products/${productId}`).catch(() => null),
        fetch(`/api/pricing?product_id=${productId}`),
      ])

      if (cancelled) return

      // GET /api/products/[id] exists now, so the placeholder row is gone. Showing a merchant
      // a fabricated name and price is worse than showing an error: the numbers look real, so a
      // pricing decision can be made against data that was never theirs.
      if (!productRes?.ok) {
        setLoadError({ status: productRes?.status ?? 0 })
        return
      }
      const json = await productRes.json()
      setProduct({
        id: json.id,
        display_name: json.display_name,
        sku: json.sku,
        base_price_cents: json.base_price_cents,
        base_currency: json.base_currency,
      })

      const pricingJson = await pricingRes.json()
      const map: PricingMap = {}
      ;(pricingJson.rows ?? []).forEach((r: any) => {
        const row: PricingRowState = {
          locale: r.locale,
          amount_cents: r.amount_cents,
          currency: r.currency,
          source: r.source ?? "manual",
          override: true, // saved rows are by definition overrides
        }
        map[r.locale] = row
      })
      setRows(map)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [productId])

  async function saveAll() {
    setSaving(true)
    setStatus(null)
    try {
      const payload = Object.values(rows)
        .filter((r) => r.override)
        .map((r) => ({
          locale: r.locale,
          amount_cents: r.amount_cents,
          currency: r.currency,
          source: r.source,
        }))
      const res = await fetch(`/api/pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: productId, rows: payload }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setStatus(`Save failed: ${err.error ?? res.statusText}`)
      } else {
        const json = await res.json()
        setStatus(`Saved — ${json.written ?? payload.length} row(s) written.`)
      }
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <div
        className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        data-testid="pricing-load-error"
      >
        <p className="font-medium">Could not load this product.</p>
        <p className="mt-1">
          The pricing matrix needs the product&rsquo;s real name and base price, so it will not
          render with placeholder values.
          {loadError.status ? ` (HTTP ${loadError.status})` : ""}
        </p>
        <button
          type="button"
          className="mt-2 underline"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    )
  }

  if (!product) {
    return <p className="text-sm text-ink-500">Loading pricing matrix…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/products/${productId}`}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-700 mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to product
          </Link>
          <h1 className="text-2xl font-bold text-ink-900">
            Locale pricing
            <span className="ml-2 font-mono text-xs bg-ink-100 text-ink-600 px-2 py-0.5 rounded">
              {product.sku || product.display_name}
            </span>
          </h1>
          <p className="text-sm text-ink-500 mt-1">
            Override the shipped per-country template (
            {(product.base_price_cents / 100).toFixed(2)} {product.base_currency}{" "}
            base). Unticked rows fall back to the auto-resolved template price
            at checkout.
          </p>
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 disabled:opacity-50 flex-shrink-0"
        >
          <Save className="w-3.5 h-3.5" />
          {saving ? "Saving…" : "Save all"}
        </button>
      </div>

      {status && (
        <div className="text-xs text-ink-600 bg-ink-50 border border-ink-100 rounded px-3 py-2">
          {status}
        </div>
      )}

      <LocaleMatrix
        baseCents={product.base_price_cents}
        rows={rows}
        onChange={setRows}
      />
    </div>
  )
}
