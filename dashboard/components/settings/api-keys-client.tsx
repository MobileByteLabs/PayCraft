"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Copy, Eye, EyeOff, RefreshCw } from "lucide-react"
import { Card, CardBody } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

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
    setTimeout(() => setCopied(null), 1500)
  }

  return (
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
        meta={
          <span className="text-warning-700">
            ⚠ Recommended: rotate every 90 days
          </span>
        }
      />
    </div>
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
  meta?: React.ReactNode
}) {
  const display = revealed
    ? value
    : value.substring(0, 12) + "•".repeat(Math.max(0, value.length - 12))
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-ink-900">{label}</span>
              {badge}
            </div>
            <p className="text-xs text-ink-500 mt-1 leading-relaxed">{sublabel}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-ink-700 bg-ink-50 border border-ink-200 px-3 py-2.5 rounded-lg break-all">
            {display}
          </code>
          <button
            type="button"
            onClick={onToggle}
            className="btn-secondary btn-sm px-3 py-2.5"
            aria-label={revealed ? "Hide" : "Reveal"}
          >
            {revealed ? (
              <EyeOff className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="btn-secondary btn-sm px-3 py-2.5"
            aria-label="Copy"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-success-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={onRotate}
            disabled={rotating}
            className="inline-flex items-center justify-center px-3 py-2.5 rounded-lg border border-warning-200 text-warning-700 text-xs font-medium hover:bg-warning-50 disabled:opacity-50 transition-colors"
          >
            {rotating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        {meta && (
          <div className="text-2xs text-ink-500 mt-3 font-medium">{meta}</div>
        )}
      </CardBody>
    </Card>
  )
}
