"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  ChevronDown,
  ExternalLink,
  Eye,
  Pencil,
  RefreshCcw,
  Check,
  AlertCircle,
} from "lucide-react"

type SyncReport = { status: "ok" | "failed" | "skipped"; message?: string }

/**
 * Compact action menu shown in the rightmost column of the /products table.
 *
 * Actions:
 *   View   — opens the product detail page (read-only, summary card)
 *   Edit   — opens the product edit form
 *   Re-sync — POST /api/products/{id}/sync; pushes the product to every
 *             connected provider and shows the per-provider result inline.
 *             Useful after re-connecting a provider or changing pricing.
 *   Open in Stripe — only when the product has a stripe_product_id;
 *             deep-links to the product page on dashboard.stripe.com (test
 *             or live depending on the connected key mode).
 *
 * Refreshes the server-component table after a successful re-sync so the
 * green/amber chips reflect the new state.
 */
export function ProductRowActions({
  productId,
  sku,
  hasStripe,
  stripeProductId,
  stripeLivemode,
  stripeConnected,
  razorpayConnected,
}: {
  productId: string
  sku: string
  hasStripe: boolean
  stripeProductId: string | null
  stripeLivemode: boolean
  stripeConnected: boolean
  razorpayConnected: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastResult, setLastResult] = useState<{
    stripe: SyncReport
    razorpay: SyncReport
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stripeUrl =
    hasStripe && stripeProductId
      ? `https://dashboard.stripe.com/${stripeLivemode ? "" : "test/"}products/${stripeProductId}`
      : null

  const canSync = stripeConnected || razorpayConnected

  async function reSync() {
    setSyncing(true)
    setError(null)
    setLastResult(null)
    try {
      const res = await fetch(`/api/products/${productId}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "Sync failed")
        return
      }
      setLastResult(data)
      // Refresh the server-rendered list so the chips update.
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-ink-700 border border-ink-200 bg-white rounded hover:bg-ink-50"
        aria-label={`Actions for ${sku}`}
      >
        Actions
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-1 w-56 bg-white border border-ink-200 rounded-lg shadow-lg z-20 py-1 text-left">
            <Link
              href={`/products/${productId}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs text-ink-700 hover:bg-ink-50"
            >
              <Eye className="w-3.5 h-3.5" />
              View product
            </Link>
            <Link
              href={`/products/${productId}/edit`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-xs text-ink-700 hover:bg-ink-50"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit product
            </Link>
            {canSync && (
              <button
                type="button"
                disabled={syncing}
                onClick={() => {
                  void reSync()
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-ink-700 hover:bg-ink-50 disabled:opacity-60"
              >
                {syncing ? (
                  <span className="inline-block w-3.5 h-3.5 border-2 border-ink-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <RefreshCcw className="w-3.5 h-3.5" />
                )}
                {syncing ? "Syncing…" : "Re-sync to providers"}
              </button>
            )}
            {stripeUrl && (
              <a
                href={stripeUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-ink-700 hover:bg-ink-50 border-t border-ink-100"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open on Stripe
              </a>
            )}
            {!canSync && (
              <div className="px-3 py-2 text-[11px] text-ink-400 border-t border-ink-100">
                Connect a provider at <Link href="/providers" className="underline">/providers</Link> to enable sync.
              </div>
            )}
            {lastResult && (
              <div className="px-3 py-2 border-t border-ink-100 space-y-1">
                <SyncBadge name="Stripe" report={lastResult.stripe} />
                <SyncBadge name="Razorpay" report={lastResult.razorpay} />
              </div>
            )}
            {error && (
              <div className="px-3 py-2 border-t border-ink-100">
                <span className="text-[11px] text-danger-700 font-mono">{error}</span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SyncBadge({ name, report }: { name: string; report: SyncReport }) {
  if (report.status === "skipped") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-ink-400">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-300" />
        {name} · not connected
      </div>
    )
  }
  if (report.status === "ok") {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
        <Check className="w-3 h-3" />
        {name} synced
      </div>
    )
  }
  return (
    <div className="flex items-start gap-1.5 text-[11px] text-warning-700">
      <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
      <div>
        {name} failed
        {report.message && <div className="text-[10px] text-ink-500 mt-0.5 font-mono">{report.message}</div>}
      </div>
    </div>
  )
}
