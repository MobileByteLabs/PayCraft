"use client"

// Analytics ▸ Google Analytics: connect a GA4 property (paycraft-paywall-analytics T16, GOAL D4). The tenant adds
// PayCraft's service-account email as a Viewer on their property, then enters the numeric property id; the connect
// call runs a test report and stores whether PayCraft could read it.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CopyButton } from "@/components/ui/copy-button"
import { ga4ErrorMessage } from "@/lib/ga4-messages"

export type Ga4ConnectionRow = { property_id: string; verified_at: string | null; last_error: string | null; stream_ids?: string[] }

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`
}

export function Ga4ConnectCard({ saEmail, connection }: { saEmail: string | null; connection: Ga4ConnectionRow | null }) {
  const router = useRouter()
  const [propertyId, setPropertyId] = useState(connection?.property_id ?? "")
  const [streams, setStreams] = useState((connection?.stream_ids ?? []).join(", "))
  const streamIds = streams.split(/[\s,]+/).filter(Boolean)
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null)
  const [error, setError] = useState<string | null>(connection?.last_error ?? null)

  async function connect(id = propertyId) {
    setBusy("connect")
    setError(null)
    const res = await fetch("/api/ga4/connection", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: id.trim(), streamIds }) })
    const body = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok || body.ok === false) setError(String(body.error ?? `http_${res.status}`))
    router.refresh()
  }

  async function disconnect() {
    setBusy("disconnect")
    await fetch("/api/ga4/connection", { method: "DELETE" })
    setBusy(null)
    setError(null)
    setPropertyId("")
    router.refresh()
  }

  if (!saEmail) {
    return <p className="text-sm text-ink-500" data-testid="ga4-not-configured">{ga4ErrorMessage("not_configured", null)}</p>
  }

  if (connection?.verified_at) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3" data-testid="ga4-connected">
        <p className="flex items-center gap-2 text-sm text-ink-700">
          <Check className="h-4 w-4 text-success-600" strokeWidth={2.5} />
          Connected to property <span className="font-semibold tabular-nums">{connection.property_id}</span>
          <span className="text-ink-400">· verified {ago(connection.verified_at)}</span>
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" loading={busy === "connect"} onClick={() => connect(connection.property_id)}>Re-check</Button>
          <Button type="button" size="sm" variant="ghost" loading={busy === "disconnect"} onClick={disconnect}>Disconnect</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-4" data-testid="ga4-connect">
      <ol className="grid gap-3 text-sm text-ink-700">
        <li className="grid gap-1.5">
          <span><span className="font-semibold">1.</span> In GA4 ▸ Admin ▸ Property access management, add this email as a <span className="font-semibold">Viewer</span>:</span>
          <span className="flex items-center gap-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs">
            <span className="min-w-0 flex-1 truncate" data-testid="ga4-sa-email">{saEmail}</span>
            <CopyButton value={saEmail} />
          </span>
        </li>
        <li className="grid gap-1.5">
          <span><span className="font-semibold">2.</span> Enter the property id (Admin ▸ Property details — digits, not the G-… id):</span>
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void connect() }}>
            <input className="input w-48 tabular-nums" inputMode="numeric" placeholder="123456789" value={propertyId}
              onChange={(e) => setPropertyId(e.target.value.replace(/[^0-9]/g, ""))} aria-label="GA4 property id" data-testid="ga4-property" />
            <Button type="submit" loading={busy === "connect"} disabled={!/^[0-9]{6,12}$/.test(propertyId)}>Connect</Button>
          </form>
        </li>
        <li className="grid gap-1.5">
          <span><span className="font-semibold">3.</span> Optional — if this property also holds other apps, the stream ids that are yours (Admin ▸ Data streams), comma-separated:</span>
          <input className="input w-full max-w-md tabular-nums" inputMode="numeric" placeholder="10231617924, 13221627257" value={streams}
            onChange={(e) => setStreams(e.target.value.replace(/[^0-9, ]/g, ""))} aria-label="GA4 stream ids" data-testid="ga4-streams" />
        </li>
      </ol>
      {error && (
        <p className="flex items-start gap-2 rounded-md bg-warning-50 px-3 py-2 text-sm text-warning-700" role="alert" data-testid="ga4-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />{ga4ErrorMessage(error, saEmail)}
        </p>
      )}
    </div>
  )
}
