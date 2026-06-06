"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, Eye, EyeOff, RefreshCw, History } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { clsx } from "clsx"

export function ApiKeysClient({
  test,
  live,
}: {
  test: string
  live: string
}) {
  const router = useRouter()
  const [revealed, setRevealed] = useState({ test: false, live: false })
  const [rotating, setRotating] = useState<"test" | "live" | null>(null)
  const [copied, setCopied] = useState<"test" | "live" | null>(null)
  const [showToast, setShowToast] = useState(false)

  async function rotate(mode: "test" | "live") {
    const ok = confirm(
      `Rotate ${mode} key? The existing key will stop working immediately. Update your apps before rotating.`,
    )
    if (!ok) return
    setRotating(mode)
    const res = await fetch(`/api/api-keys/rotate?mode=${mode}`, {
      method: "POST",
    })
    setRotating(null)
    if (res.ok) router.refresh()
  }

  async function copy(value: string, key: "test" | "live") {
    await navigator.clipboard.writeText(value)
    setCopied(key)
    setShowToast(true)
    setTimeout(() => {
      setCopied(null)
      setShowToast(false)
    }, 2000)
  }

  return (
    <>
      <div className="space-y-4">
        <KeyCard
          label="Test mode"
          kind="test"
          sublabel="Use during development; no real charges. Maps to /functions/v1/config locale fallbacks."
          badge={<Badge tone="info">Sandbox</Badge>}
          value={test}
          revealed={revealed.test}
          onToggle={() => setRevealed((r) => ({ ...r, test: !r.test }))}
          onRotate={() => rotate("test")}
          onCopy={() => copy(test, "test")}
          rotating={rotating === "test"}
          copied={copied === "test"}
          meta="Last rotated 12 days ago"
        />
        <KeyCard
          label="Live mode"
          kind="live"
          sublabel="Production key — guard carefully. Pushes real charges to your Stripe Connect account."
          badge={<Badge tone="success">Production</Badge>}
          value={live}
          revealed={revealed.live}
          onToggle={() => setRevealed((r) => ({ ...r, live: !r.live }))}
          onRotate={() => rotate("live")}
          onCopy={() => copy(live, "live")}
          rotating={rotating === "live"}
          copied={copied === "live"}
          meta="Last rotated 47 days ago"
          metaWarning="Recommended: rotate every 90 days"
        />
      </div>

      {/* Copy Toast */}
      <div
        className={clsx(
          "fixed bottom-8 right-8 bg-ink-900 text-white px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 transition-all duration-300 z-[100]",
          showToast
            ? "translate-y-0 opacity-100"
            : "translate-y-24 opacity-0 pointer-events-none",
        )}
      >
        <Check className="w-4 h-4 text-success-400" strokeWidth={2.5} />
        <span className="text-sm font-medium">Copied to clipboard</span>
      </div>
    </>
  )
}

function KeyCard({
  label,
  kind,
  sublabel,
  badge,
  value,
  revealed,
  onToggle,
  onRotate,
  onCopy,
  rotating,
  copied,
  meta,
  metaWarning,
}: {
  label: string
  kind: "test" | "live"
  sublabel: string
  badge: React.ReactNode
  value: string
  revealed: boolean
  onToggle: () => void
  onRotate: () => void
  onCopy: () => void
  rotating: boolean
  copied: boolean
  meta?: string
  metaWarning?: string
}) {
  const masked =
    value.substring(0, kind === "test" ? 8 : 8) +
    "•".repeat(Math.max(0, value.length - 8))
  const display = revealed ? value : masked

  return (
    <div className="bg-white border border-ink-200 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-bold text-ink-900">{label}</h3>
          {badge}
        </div>
      </div>
      <p className="text-sm text-ink-500 mb-6">{sublabel}</p>
      <div className="flex flex-col md:flex-row gap-2">
        <div className="flex-1 bg-ink-50 border border-ink-200 rounded-lg px-4 py-2.5 font-mono text-sm text-ink-600 flex items-center">
          <span
            className={clsx("flex-1 break-all", !revealed && "tracking-wider")}
          >
            {display}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-ink-200 rounded-lg text-xs font-semibold text-ink-700 hover:bg-ink-50 transition-colors"
            aria-label={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? (
              <EyeOff className="w-[18px] h-[18px]" />
            ) : (
              <Eye className="w-[18px] h-[18px]" />
            )}{" "}
            {revealed ? "Hide" : "Reveal"}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-ink-200 rounded-lg text-xs font-semibold text-ink-700 hover:bg-ink-50 transition-colors"
            aria-label="Copy"
          >
            {copied ? (
              <Check className="w-[18px] h-[18px] text-success-600" />
            ) : (
              <Copy className="w-[18px] h-[18px]" />
            )}{" "}
            Copy
          </button>
          <button
            type="button"
            onClick={onRotate}
            disabled={rotating}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-orange-200 rounded-lg text-xs font-semibold text-orange-600 hover:bg-orange-50 transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={clsx("w-[18px] h-[18px]", rotating && "animate-spin")}
            />{" "}
            Rotate
          </button>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between text-[11px]">
        {meta && (
          <div className="flex items-center gap-1.5 text-ink-400">
            <History className="w-[14px] h-[14px]" />
            {meta}
          </div>
        )}
        {metaWarning && (
          <div className="flex items-center gap-1.5 text-orange-600 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse inline-block" />
            {metaWarning}
          </div>
        )}
      </div>
    </div>
  )
}
