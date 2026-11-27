"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Loader2, Save } from "lucide-react"
import { useDashboard } from "@/components/app-providers"
import {
  LocaleMatrix,
  type PricingMap,
  type PricingRowState,
} from "@/components/pricing/locale-matrix"

/**
 * Locale-pricing matrix editor — AC-32. Reads existing tenant_pricing
 * rows for the product (in the browser — RLS scopes them to the tenant), lets the user override the shipped template
 * per-country, and bulk-upserts via `tenant_pricing_bulk_upsert` on Save.
 */
export default function PricingMatrixPage() {
  const params = useParams<{ id: string }>()
  const productId = params.id
  const { tenantId, supabase } = useDashboard()

  const query = useQuery({
    queryKey: ["products", tenantId, "pricing", productId],
    queryFn: async () => {
      const [productRes, pricingRes] = await Promise.all([
        supabase
          .from("tenant_products")
          .select("id, display_name, sku, base_price_cents, base_currency")
          .eq("id", productId)
          .eq("tenant_id", tenantId)
          .maybeSingle(),
        supabase
          .from("tenant_pricing")
          .select("locale, amount_cents, currency, source")
          .eq("tenant_id", tenantId)
          .eq("product_id", productId)
          .order("locale"),
      ])
      // Showing a merchant a fabricated name and price is worse than showing an error: the numbers
      // look real, so a pricing decision can be made against data that was never theirs.
      if (productRes.error) throw new Error(productRes.error.message)
      if (!productRes.data) throw new Error("This product doesn't exist in this app.")
      if (pricingRes.error) throw new Error(pricingRes.error.message)
      const map: PricingMap = {}
      for (const r of pricingRes.data ?? []) {
        map[r.locale] = {
          locale: r.locale,
          amount_cents: r.amount_cents,
          currency: r.currency,
          source: r.source ?? "manual",
          override: true, // saved rows are by definition overrides
        } as PricingRowState
      }
      return { product: productRes.data as Product, rows: map }
    },
    // The editor copies the rows into local state once — a background refetch must not reset edits.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })

  if (query.isError) {
    return (
      <div
        role="alert"
        className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        data-testid="pricing-load-error"
      >
        <p className="font-medium">Could not load this product.</p>
        <p className="mt-1">
          The pricing matrix needs the product&rsquo;s real name and base price, so it will not
          render with placeholder values. ({query.error.message})
        </p>
        <button type="button" className="mt-2 underline" onClick={() => query.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  if (query.isPending) {
    return (
      <p role="status" aria-busy="true" className="text-sm text-ink-500 inline-flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading pricing matrix…
      </p>
    )
  }

  return <PricingEditor productId={productId} product={query.data.product} initialRows={query.data.rows} />
}

type Product = {
  id: string
  display_name: string
  sku: string
  base_price_cents: number
  base_currency: string
}

function PricingEditor({
  productId,
  product,
  initialRows,
}: {
  productId: string
  product: Product
  initialRows: PricingMap
}) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<PricingMap>(initialRows)
  const save = useMutation({
    mutationFn: async () => {
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
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`Save failed: ${json.error ?? res.statusText}`)
      return (json.written ?? payload.length) as number
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["products"] }),
  })
  const saving = save.isPending

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
          onClick={() => save.mutate()}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800 disabled:opacity-50 flex-shrink-0"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {saving ? "Saving…" : "Save all"}
        </button>
      </div>

      {save.isSuccess && (
        <div className="text-xs text-ink-600 bg-ink-50 border border-ink-100 rounded px-3 py-2">
          Saved — {save.data} row(s) written.
        </div>
      )}
      {save.isError && (
        <div role="alert" className="text-xs text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
          {save.error.message}
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
