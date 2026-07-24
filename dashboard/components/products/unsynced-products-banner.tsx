"use client"

import { useEffect, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react"

interface Preview {
  providers_connected: {
    stripe: boolean
    razorpay: boolean
    google_play: boolean
    app_store: boolean
  }
  unique_unsynced_count: number
  stripe: { unsynced_count: number; items: any[] }
  razorpay: { unsynced_count: number; items: any[] }
  google_play: { unsynced_count: number; items: any[] }
  app_store: { unsynced_count: number; items: any[] }
}

interface SyncReport {
  product_id: string
  sku: string
  display_name: string
  status: "ok" | "failed" | "skipped"
  message?: string
}

interface SyncResult {
  stripe: SyncReport[]
  razorpay: SyncReport[]
  google_play?: SyncReport[]
  app_store?: SyncReport[]
}

/**
 * Banner that surfaces products which exist in tenant_products but have NOT
 * been pushed to the connected payment provider yet. This happens when the
 * operator created products before connecting Stripe / Razorpay, or after
 * disconnecting + re-connecting under a different account.
 *
 * The banner fetches preview counts on mount; if any provider has unsynced
 * products, it renders a single "Sync N to <provider>" CTA. Clicking it POSTs
 * to /api/products/sync-to-providers which iterates each row and reports
 * per-product status. Repeated clicks are safe — the underlying Stripe sync
 * uses deterministic idempotency keys.
 */
export function UnsyncedProductsBanner() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function loadPreview() {
    try {
      const res = await fetch("/api/products/sync-to-providers", { cache: "no-store" })
      if (!res.ok) {
        // 401/500 — silently hide the banner (not actionable).
        setPreview(null)
        return
      }
      setPreview(await res.json())
    } catch {
      setPreview(null)
    }
  }

  useEffect(() => {
    void loadPreview()
  }, [])

  async function sync() {
    setSyncing(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/products/sync-to-providers", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data?.error ?? "Sync failed")
        return
      }
      setResult(data)
      // Refresh preview so the count drops after success.
      void loadPreview()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSyncing(false)
    }
  }

  if (!preview) return null

  const stripeCount = preview.stripe.unsynced_count
  const razorpayCount = preview.razorpay.unsynced_count
  const playCount = preview.google_play.unsynced_count
  const appStoreCount = preview.app_store.unsynced_count
  // Distinct-product count — the same row may need pushing to both providers
  // but the banner counts unique products, not sync operations. The server
  // also only counts connected providers (no "needs sync to Razorpay" nag
  // when Razorpay isn't even wired up).
  const totalCount = preview.unique_unsynced_count

  // No banner when everything is in sync.
  if (totalCount === 0 && !result) return null

  const connectedProviderNames = [
    preview.providers_connected.stripe ? "Stripe" : null,
    preview.providers_connected.razorpay ? "Razorpay" : null,
    preview.providers_connected.google_play ? "Google Play" : null,
    preview.providers_connected.app_store ? "App Store" : null,
  ].filter(Boolean) as string[]

  // Post-sync summary takes over (the unsynced count drops to 0 after a
  // successful run, so we wouldn't otherwise show anything).
  if (result) {
    const allReports = [
      ...result.stripe,
      ...result.razorpay,
      ...(result.google_play ?? []),
      ...(result.app_store ?? []),
    ]
    const allOk = allReports.every((r) => r.status === "ok")
    const failures = allReports.filter((r) => r.status !== "ok")
    return (
      <div
        className={`mb-6 rounded-xl border p-5 ${
          allOk
            ? "bg-success-50 border-success-200"
            : "bg-warning-50 border-warning-200"
        }`}
      >
        <div className="flex items-start gap-3">
          {allOk ? (
            <CheckCircle2 className="w-5 h-5 text-success-600 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <h3 className="text-sm font-bold text-ink-900">
              {allOk
                ? `Sync complete — ${allReports.length} products pushed to providers`
                : `Sync partially complete — ${failures.length} of ${allReports.length} failed`}
            </h3>
            {!allOk && (
              <ul className="mt-2 space-y-1 text-xs text-ink-700">
                {failures.map((f) => (
                  <li key={`${f.status}-${f.product_id}`} className="flex items-start gap-1.5">
                    <XCircle className="w-3.5 h-3.5 text-warning-600 flex-shrink-0 mt-0.5" />
                    <span>
                      <code className="font-mono">{f.sku}</code> · {f.display_name}
                      {f.message && (
                        <span className="text-ink-500"> — {f.message}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setResult(null)}
              className="mt-3 text-[11px] font-bold text-ink-600 underline hover:text-ink-800"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mb-6 rounded-xl border border-warning-200 bg-warning-50 p-5">
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-warning-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-bold text-ink-900">
            {totalCount} product{totalCount === 1 ? "" : "s"} not yet pushed to{" "}
            {connectedProviderNames.length === 1
              ? connectedProviderNames[0]
              : connectedProviderNames.length > 1
                ? "your providers"
                : "any provider"}
          </h3>
          <p className="text-xs text-ink-700 mt-1 leading-relaxed">
            These products exist in PayCraft but their{" "}
            {connectedProviderNames.length === 1
              ? `${connectedProviderNames[0]} Product / Price / Payment Link`
              : "provider-side Product / Price / Payment Link"}{" "}
            have not been created yet (common if you created the products
            before connecting the provider). Pushing them now creates the
            missing artifacts so the SDK's Payment Link URLs resolve. Safe to
            retry — sync uses idempotency keys.
          </p>
          {connectedProviderNames.length > 1 && (
            <p className="text-[11px] text-ink-500 mt-1">
              {[
                preview.providers_connected.stripe ? `Stripe: ${stripeCount}` : null,
                preview.providers_connected.razorpay ? `Razorpay: ${razorpayCount}` : null,
                preview.providers_connected.google_play ? `Google Play: ${playCount}` : null,
                preview.providers_connected.app_store ? `App Store: ${appStoreCount}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3">
            <button
              disabled={syncing}
              onClick={sync}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-warning-700 text-white rounded-lg hover:bg-warning-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Syncing {totalCount} product{totalCount === 1 ? "" : "s"}…
                </>
              ) : (
                <>
                  <RefreshCcw className="w-3.5 h-3.5" />
                  Sync {totalCount} product{totalCount === 1 ? "" : "s"} to{" "}
                  {connectedProviderNames.length === 1
                    ? connectedProviderNames[0]
                    : "providers"}
                </>
              )}
            </button>
            {error && (
              <span className="text-xs text-danger-700 font-mono">{error}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
