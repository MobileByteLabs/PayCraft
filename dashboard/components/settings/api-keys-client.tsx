"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

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

  async function rotate(mode: "test" | "live") {
    if (
      !confirm(
        `Rotate ${mode} key? The existing key will stop working immediately. Update your apps before rotating.`,
      )
    )
      return
    setRotating(mode)
    const res = await fetch(`/api/api-keys/rotate?mode=${mode}`, {
      method: "POST",
    })
    setRotating(null)
    if (res.ok) router.refresh()
  }

  return (
    <div className="space-y-4">
      <KeyRow
        label="Test mode"
        sublabel="Use during development; no real charges. Maps to /functions/v1/config locale fallbacks."
        value={test}
        revealed={revealed.test}
        onToggle={() =>
          setRevealed((r) => ({ ...r, test: !r.test }))
        }
        onRotate={() => rotate("test")}
        rotating={rotating === "test"}
      />
      <KeyRow
        label="Live mode"
        sublabel="Production key — guard carefully. Pushes real charges to your Stripe Connect account."
        value={live}
        revealed={revealed.live}
        onToggle={() =>
          setRevealed((r) => ({ ...r, live: !r.live }))
        }
        onRotate={() => rotate("live")}
        rotating={rotating === "live"}
      />
    </div>
  )
}

function KeyRow({
  label,
  sublabel,
  value,
  revealed,
  onToggle,
  onRotate,
  rotating,
}: {
  label: string
  sublabel: string
  value: string
  revealed: boolean
  onToggle: () => void
  onRotate: () => void
  rotating: boolean
}) {
  const display = revealed ? value : value.substring(0, 11) + "•".repeat(40)
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-medium text-gray-900">{label}</div>
          <div className="text-xs text-gray-500 mt-0.5">{sublabel}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 rounded bg-gray-50 border border-gray-200 px-3 py-2 text-xs font-mono break-all">
          {display}
        </code>
        <button
          type="button"
          onClick={onToggle}
          className="rounded border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
        <button
          type="button"
          onClick={() => navigator.clipboard.writeText(value)}
          className="rounded border border-gray-300 px-3 py-2 text-xs font-medium hover:bg-gray-50"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={onRotate}
          disabled={rotating}
          className="rounded border border-orange-300 text-orange-700 px-3 py-2 text-xs font-medium hover:bg-orange-50 disabled:opacity-50"
        >
          {rotating ? "Rotating…" : "Rotate"}
        </button>
      </div>
    </div>
  )
}
