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

      // The /api/products/[id] GET may not exist yet — fall back to a stub.
      let p: typeof product = null
      if (productRes?.ok) {
        const json = await productRes.json()
        p = {
          id: json.id ?? productId,
          display_name: json.display_name ?? "Product",
          sku: json.sku ?? "",
          base_price_cents: json.base_price_cents ?? 999,
          base_currency: json.base_currency ?? "USD",
        }
      } else {
        p = {
          id: productId,
          display_name: "Product",
          sku: "",
          base_price_cents: 999,
          base_currency: "USD",
        }
      }
      setProduct(p)

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
