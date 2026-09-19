"use client"

import { useRef, useState } from "react"
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
  hasPlay,
  hasAppStore,
  playConnected,
  appStoreConnected,
}: {
  productId: string
  sku: string
  hasStripe: boolean
  stripeProductId: string | null
  stripeLivemode: boolean
  stripeConnected: boolean
  razorpayConnected: boolean
  hasPlay: boolean
  hasAppStore: boolean
  playConnected: boolean
  appStoreConnected: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  // Report shape mirrors the /api/products/{id}/sync response keys exactly:
  // stripe / razorpay / cashfree / google_play / app_store (snake_case).
  const [lastResult, setLastResult] = useState<{
    stripe: SyncReport
    razorpay: SyncReport
    cashfree?: SyncReport
    google_play?: SyncReport
    app_store?: SyncReport
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const stripeUrl =
    hasStripe && stripeProductId
      ? `https://dashboard.stripe.com/${stripeLivemode ? "" : "test/"}products/${stripeProductId}`
      : null

  // Re-sync is enabled when ANY provider — web PSP or native store — is
  // connected, so a store-only tenant can still push subscription products.
  const canSync =
    stripeConnected || razorpayConnected || playConnected || appStoreConnected

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

  // The menu must escape its ancestors' clipping. The products table wrapper is `overflow-hidden`
  // (it needs that for its rounded corners), and an absolutely-positioned child of a clipping box is
  // cut off at the box edge — which is why the last row's menu appeared truncated. Measuring the
  // trigger and rendering the menu `fixed` takes it out of that containing block entirely, so no
  // ancestor's overflow can clip it regardless of where the row sits.
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null)

  function toggle() {
    const next = !open
    if (next && triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      const MENU_W = 224 // w-56
      // Flip upward when there is not room below, so a row near the viewport bottom still shows all
      // of its options rather than running off-screen.
      const openUp = window.innerHeight - r.bottom < 120
      setMenuPos({
        top: openUp ? r.top - 8 : r.bottom + 4,
        left: Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8)),
      })
    }
    setOpen(next)
  }

  return (
    <div className="relative inline-block text-left">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-ink-700 border border-ink-200 bg-white rounded hover:bg-ink-50"
        aria-label={`Actions for ${sku}`}
      >
        Actions
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="fixed w-56 bg-white border border-ink-200 rounded-lg shadow-lg z-50 py-1 text-left"
            style={menuPos ? { top: menuPos.top, left: menuPos.left } : undefined}
          >
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
                {lastResult.cashfree && (
                  <SyncBadge name="Cashfree" report={lastResult.cashfree} />
                )}
                {lastResult.google_play && (
                  <SyncBadge name="Google Play" report={lastResult.google_play} />
                )}
                {lastResult.app_store && (
                  <SyncBadge name="App Store" report={lastResult.app_store} />
                )}
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
    // A skip ALWAYS explains itself (not connected / no pricing / type unsupported).
    return (
      <div className="flex items-start gap-1.5 text-[11px] text-ink-400">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-300 flex-shrink-0 mt-1" />
        <div>
          {name} skipped
          <div className="text-[10px] text-ink-500 mt-0.5">{report.message ?? "not connected"}</div>
        </div>
      </div>
    )
  }
  if (report.status === "ok") {
    return (
      <div className="flex items-start gap-1.5 text-[11px] text-emerald-700">
        <Check className="w-3 h-3 flex-shrink-0 mt-0.5" />
        <div>
          {name} synced
          {/* draft: base synced but the trial offer is DRAFT until the app is published */}
          {report.message && <div className="text-[10px] text-amber-600 mt-0.5">{report.message}</div>}
        </div>
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
