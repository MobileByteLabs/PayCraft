"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react"
import { SyncStatusDialog } from "./sync-status-dialog"

type SyncReport = {
  /**
   * `draft` = the provider accepted the product but it is NOT purchasable yet (a Play base
   * plan awaiting activation, an App Store subscription waiting on app publication). It is
   * neither success nor failure, and rendering it as either misleads: "synced" hides that
   * the store will not sell it, "failed" sends the operator hunting a bug that isn't there.
   */
  status: "ok" | "draft" | "failed" | "skipped"
  message?: string
}

type StripeVerification = "verified" | "stale" | "unsynced" | "unknown"

interface Props {
  productId: string
  initialStripeProductId: string | null
  initialRazorpayPlanIds: Record<string, string> | null
  initialPlayProductId: string | null
  initialAppStoreProductId: string | null
  stripeVerification: StripeVerification
}

interface ProviderConnections {
  providers_connected: {
    stripe: boolean
    razorpay: boolean
    google_play: boolean
    app_store: boolean
  }
}

/**
 * Sync panel on the product detail page. Shows current provider sync state
 * with deep-links into Stripe Dashboard, plus a "Sync to providers" CTA
 * mirroring the per-row action from the products list. Renders inside the
 * detail page so the operator never has to bounce back to /products to
 * push a single change.
 */
export function ProductSyncPanel({
  productId,
  initialStripeProductId,
  initialRazorpayPlanIds,
  initialPlayProductId,
  initialAppStoreProductId,
  stripeVerification,
}: Props) {
  const router = useRouter()
  const [connections, setConnections] = useState<ProviderConnections | null>(null)
  const [syncing, setSyncing] = useState(false)
  // Report keys mirror the /api/products/{id}/sync response exactly:
  // stripe / razorpay / cashfree / google_play / app_store (snake_case).
  const [result, setResult] = useState<{
    stripe: SyncReport
    razorpay: SyncReport
    cashfree?: SyncReport
    google_play?: SyncReport
    app_store?: SyncReport
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [syncRunId, setSyncRunId] = useState("")

  const connectedProviders = (): string[] => {
    const pc = connections?.providers_connected
    if (!pc) return ["stripe", "razorpay", "google_play", "app_store"]
    return (Object.keys(pc) as (keyof typeof pc)[]).filter((k) => pc[k])
  }

  // Drive the sync one provider per request (Cloudflare free-tier subrequest
  // cap), all sharing runId so the live dialog streams every provider's progress.
  async function startSync() {
    await Promise.all(
      connectedProviders().map((p) =>
        fetch(`/api/products/${productId}/sync?provider=${p}&run_id=${syncRunId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }).catch(() => {}),
      ),
    )
    router.refresh()
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/products/sync-to-providers", { cache: "no-store" })
        if (!res.ok) return
        const data = (await res.json()) as ProviderConnections
        setConnections(data)
      } catch {
        // Non-fatal — the panel still renders with current sync state, just
        // without the "provider connected?" context (so the CTA falls back
        // to "Sync now" without the provider hint).
      }
    })()
  }, [])

  async function sync() {
    setSyncing(true)
    setError(null)
    setResult(null)
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
      setResult(data)
      router.refresh()
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setSyncing(false)
    }
  }

  const stripeUrl = initialStripeProductId
    ? `https://dashboard.stripe.com/test/products/${initialStripeProductId}`
    : null
  const razorpaySynced =
    !!initialRazorpayPlanIds && Object.keys(initialRazorpayPlanIds).length > 0
  const playSynced = !!initialPlayProductId
  const appStoreSynced = !!initialAppStoreProductId

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-ink-900">Provider sync</h3>
          <p className="text-xs text-ink-500 mt-0.5">
            Push this product's Stripe Product / Price / Payment Link (and
            Razorpay Plan) to each connected provider. Re-running heals any
            account drift — orphan IDs from a previous connection get
            replaced with fresh ones on the currently-saved key.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setSyncRunId(crypto.randomUUID())
            setSyncOpen(true)
          }}
          disabled={syncOpen}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
        >
          <RefreshCcw className="w-3.5 h-3.5" /> Sync to providers
        </button>
      </div>

      <SyncStatusDialog
        open={syncOpen}
        runId={syncRunId}
        title="Syncing to providers"
        expectedRows={connectedProviders().length}
        onStart={startSync}
        onClose={() => setSyncOpen(false)}
      />

      <div className="grid grid-cols-2 gap-3">
        <ProviderCard
          name="Stripe"
          connected={connections?.providers_connected.stripe ?? null}
          synced={stripeVerification === "verified"}
          stale={stripeVerification === "stale"}
          unverified={
            stripeVerification === "unknown" && !!initialStripeProductId
          }
          externalUrl={stripeVerification === "verified" ? stripeUrl : null}
          settingsUrl="/providers/stripe"
        />
        <ProviderCard
          name="Razorpay"
          connected={connections?.providers_connected.razorpay ?? null}
          synced={razorpaySynced}
          externalUrl={null}
          settingsUrl="/providers/razorpay"
        />
        <ProviderCard
          name="Google Play"
          connected={connections?.providers_connected.google_play ?? null}
          synced={playSynced}
          externalUrl={null}
          settingsUrl="/providers/google-play"
        />
        <ProviderCard
          name="App Store"
          connected={connections?.providers_connected.app_store ?? null}
          synced={appStoreSynced}
          externalUrl={null}
          settingsUrl="/providers/app-store"
        />
      </div>

      {result && (
        <div className="rounded-lg border border-ink-200 bg-ink-50/50 p-3 space-y-1.5">
          <ResultLine name="Stripe" report={result.stripe} />
          <ResultLine name="Razorpay" report={result.razorpay} />
          {result.cashfree && <ResultLine name="Cashfree" report={result.cashfree} />}
          {result.google_play && (
            <ResultLine name="Google Play" report={result.google_play} />
          )}
          {result.app_store && (
            <ResultLine name="App Store" report={result.app_store} />
          )}
        </div>
      )}

      {error && (
        <div className="text-xs text-danger-700 font-mono bg-danger-50 border border-danger-200 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}
    </div>
  )
}

function ProviderCard({
  name,
  connected,
  synced,
  stale = false,
  unverified = false,
  externalUrl,
  settingsUrl,
}: {
  name: string
  connected: boolean | null
  synced: boolean
  stale?: boolean
  unverified?: boolean
  externalUrl: string | null
  settingsUrl: string
}) {
  // Tone selection in priority order: stale > unverified > synced > pending >
  // not-connected. "stale" means the DB has an ID but the provider returns
  // resource_missing (account drift); "unverified" means we couldn't reach
  // the provider to confirm — surface both distinctly from a clean ✓.
  const tone = stale
    ? "stale"
    : connected === false
      ? "muted"
      : synced
        ? "good"
        : unverified
          ? "unverified"
          : connected
            ? "pending"
            : "muted"
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "good"
          ? "bg-emerald-50 border-emerald-200"
          : tone === "pending"
            ? "bg-warning-50 border-warning-200"
            : tone === "stale"
              ? "bg-danger-50 border-danger-200"
              : tone === "unverified"
                ? "bg-ink-50 border-ink-300"
                : "bg-ink-50 border-ink-200"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-ink-900">{name}</span>
        {tone === "good" && (
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
            Verified ✓
          </span>
        )}
        {tone === "pending" && (
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-warning-100 text-warning-700 px-1.5 py-0.5 rounded-full">
            Pending
          </span>
        )}
        {tone === "stale" && (
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-danger-100 text-danger-700 px-1.5 py-0.5 rounded-full">
            Stale ⚠
          </span>
        )}
        {tone === "unverified" && (
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-ink-200 text-ink-600 px-1.5 py-0.5 rounded-full">
            Unverified
          </span>
        )}
        {tone === "muted" && connected === false && (
          <span className="text-[10px] font-bold uppercase tracking-tighter bg-ink-100 text-ink-500 px-1.5 py-0.5 rounded-full">
            Not connected
          </span>
        )}
      </div>
      <div className="mt-2 text-[11px] text-ink-600 leading-relaxed">
        {tone === "good" && externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline text-emerald-700 hover:text-emerald-900"
          >
            Open on {name} <ExternalLink className="w-3 h-3" />
          </a>
        )}
        {tone === "good" && !externalUrl && (
          <span className="text-ink-500">
            Plan IDs stored. {name} doesn't expose a deep-link for products.
          </span>
        )}
        {tone === "pending" && (
          <span>
            Push pending — click <strong>Sync to providers</strong> above.
          </span>
        )}
        {tone === "stale" && (
          <span>
            {name} doesn't recognize the saved product ID — usually means the
            connected key now points at a different account. Click{" "}
            <strong>Sync to providers</strong> above; the saved ID will be
            replaced with a fresh one on the current account.
          </span>
        )}
        {tone === "unverified" && (
          <span>
            Saved ID present but couldn't reach {name} to confirm. Network /
            credentials issue — re-sync to refresh.
          </span>
        )}
        {tone === "muted" && connected === false && (
          <Link
            href={settingsUrl}
            className="inline-flex items-center gap-1 underline text-ink-600 hover:text-ink-900"
          >
            Connect {name} →
          </Link>
        )}
        {tone === "muted" && connected === null && (
          <span className="text-ink-400">Checking connection…</span>
        )}
      </div>
    </div>
  )
}

function ResultLine({ name, report }: { name: string; report: SyncReport }) {
  if (report.status === "skipped") {
    // A skip always states WHY (not connected / no pricing / type unsupported).
    return (
      <div className="flex items-start gap-1.5 text-[11px] text-ink-500">
        <span className="w-1.5 h-1.5 rounded-full bg-ink-300 flex-shrink-0 mt-1" />
        <div>
          {name} skipped
          <div className="text-[10px] text-ink-400 mt-0.5">{report.message ?? "not connected"}</div>
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
          {report.message && <div className="text-[10px] text-amber-600 mt-0.5">{report.message}</div>}
        </div>
      </div>
    )
  }
  if (report.status === "draft") {
    // Created but not sellable. The message carries the operator's next action (publish the
    // app / activate the plan manually), so it is shown at full weight rather than as a
    // muted footnote.
    return (
      <div className="flex items-start gap-1.5 text-[11px] text-amber-700">
        <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
        <div>
          {name} created — not purchasable yet
          {report.message && (
            <div className="text-[10px] text-amber-600 mt-0.5">{report.message}</div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-1.5 text-[11px] text-warning-700">
      <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
      <div>
        {name} failed
        {report.message && (
          <div className="text-[10px] text-ink-500 mt-0.5 font-mono">
            {report.message}
          </div>
        )}
      </div>
    </div>
  )
}
