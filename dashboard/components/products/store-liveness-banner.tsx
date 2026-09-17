"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, Loader2, RefreshCcw } from "lucide-react"

/**
 * "Is your app actually live on the store?" — shown above the product list.
 *
 * Both stores refuse to make a product PURCHASABLE until the app itself is published, and
 * both report that as an opaque provider error. Without this banner the operator sees a
 * product that says "synced" and a device that says "Product not found", with nothing
 * connecting the two. This states the blocker and the next action directly.
 *
 * Three states per store, and the third matters: `unknown` (probe unreachable) is rendered
 * as "couldn't check", never as "not published" — accusing a live app of being unpublished
 * because our egress blipped would send the operator down a false trail.
 */

type LivenessStatus = "live" | "not-published" | "unknown"

interface Liveness {
  store: "google_play" | "app_store"
  id: string
  status: LivenessStatus
  live: boolean
  url: string
  message: string
}

interface StoreReport {
  connected: boolean
  id: string | null
  liveness: Liveness | null
  reason?: string
}

interface Payload {
  google_play: StoreReport
  app_store: StoreReport
  blocks_activation: boolean
}

const LABEL: Record<"google_play" | "app_store", string> = {
  google_play: "Google Play",
  app_store: "App Store",
}

function StoreRow({
  store,
  report,
}: {
  store: "google_play" | "app_store"
  report: StoreReport
}) {
  const name = LABEL[store]

  // Not connected is not a problem to report here — the connect prompt lives in settings.
  if (!report.connected) return null

  if (!report.liveness) {
    return (
      <div className="flex items-start gap-2 text-[12px] text-ink-500">
        <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-medium text-ink-700">{name}</span> — {report.reason}
        </div>
      </div>
    )
  }

  const { status, url, message } = report.liveness

  if (status === "live") {
    return (
      <div className="flex items-start gap-2 text-[12px] text-emerald-700">
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-medium">{name}</span> — app is live.{" "}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 underline text-ink-600 hover:text-ink-900"
          >
            View listing <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    )
  }

  if (status === "not-published") {
    return (
      <div className="flex items-start gap-2 text-[12px] text-amber-700">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-medium">{name}</span> — app is not published.
          <div className="text-[11px] text-amber-600 mt-0.5">{message}</div>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 underline text-ink-600 hover:text-ink-900 mt-0.5"
          >
            Check the public listing <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-2 text-[12px] text-ink-500">
      <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      <div>
        <span className="font-medium text-ink-700">{name}</span> — couldn&apos;t check the
        listing right now.
        <div className="text-[11px] text-ink-400 mt-0.5">{message}</div>
      </div>
    </div>
  )
}

export function StoreLivenessBanner() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/providers/store-liveness", { cache: "no-store" })
      if (!res.ok) {
        setData(null)
        return
      }
      setData((await res.json()) as Payload)
    } catch {
      // A failed probe must never break the products page — the banner simply hides.
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-ink-400 px-4 py-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking store listings…
      </div>
    )
  }

  if (!data) return null

  const rows = (["google_play", "app_store"] as const).filter(
    (s) => data[s].connected,
  )
  if (rows.length === 0) return null

  const blocked = data.blocks_activation

  return (
    <div
      className={`rounded-lg border px-4 py-3 space-y-2 ${
        blocked ? "border-amber-200 bg-amber-50/60" : "border-ink-100 bg-ink-50/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[12px] font-medium text-ink-700">
          {blocked ? "Store products can't be activated yet" : "Store listings"}
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 text-[11px] text-ink-500 hover:text-ink-900"
        >
          <RefreshCcw className="w-3 h-3" /> Re-check
        </button>
      </div>
      {rows.map((s) => (
        <StoreRow key={s} store={s} report={data[s]} />
      ))}
    </div>
  )
}
