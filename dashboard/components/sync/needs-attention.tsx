"use client"

import { useRouter } from "next/navigation"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react"

/**
 * "Needs attention (N)" — the global reconcile surface.
 *
 * The per-product page still has its own sync action, but it stopped being the only door. Nothing
 * previously surfaced the backlog: four products sat `sync_status='pending'` in production with no
 * screen that said so, and the defects that actually cost money — an unpublished paywall, a test key
 * in a live slot, an active provider with zero links — were not "pending" anything, so no
 * flag-shaped view could ever have shown them.
 *
 * Findings are grouped by kind rather than listed flat: the five classes have different fixes, and
 * an operator triaging them thinks "what kind of problem do I have" before "which row".
 */

interface Finding {
  kind: string
  tenant_id: string
  subject: string
  detail: string
  action_hint: string
  subject_id?: string
}

const KIND_LABEL: Record<string, string> = {
  "product-missing-at-provider": "Products missing at provider",
  "paywall-not-published": "Paywall not published",
  "credential-mode-mismatch": "Credential in the wrong mode",
  "active-provider-zero-links": "Active provider with no checkout links",
  "missing-currency-for-country": "Served country with no price",
}

export function NeedsAttention({ tenantId }: { tenantId: string }) {
  const router = useRouter()
  const [findings, setFindings] = useState<Finding[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async (force = false) => {
    setError(null)
    try {
      const res = await fetch(`/api/sync/drift?tenant_id=${encodeURIComponent(tenantId)}${force ? "&force=1" : ""}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `failed (${res.status})`)
      setFindings(json.findings ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setFindings([])
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  async function syncAll() {
    if (!findings) return
    setBusy(true); setError(null); setNote(null)
    try {
      // The count the operator just saw is echoed back. If the world moved since, the server
      // refuses with 409 rather than bulk-writing to live providers on stale intent.
      const res = await fetch("/api/sync/all", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_id: tenantId, confirm_count: findings.length }),
      })
      const json = await res.json()
      if (res.status === 409) {
        setError(json.detail ?? "The drift set changed — re-read the report and confirm again.")
        await load(true)
        return
      }
      if (!res.ok) throw new Error(json?.error ?? `failed (${res.status})`)
      // A per-provider SKIP is not a sync. The drain used to count every product it walked as
      // synced, so a run where every product recorded `razorpay: skipped — not connected` still
      // reported "Synced 3 item(s)" and the finding it was meant to clear survived every retry.
      // Report the three outcomes separately; a number the operator cannot act on is worse than none.
      const parts = [`Synced ${json.synced} item(s).`]
      if (json.priced_locales) parts.push(`Priced ${json.priced_locales} served locale(s).`)
      if (json.skipped?.length) parts.push(`${json.skipped.length} skipped — ${json.skipped[0].detail}.`)
      if (json.failed?.length) parts.push(`${json.failed.length} failed — ${json.failed[0].detail}.`)
      if (json.needs_human?.length) parts.push(`${json.needs_human.length} need a decision you have to make.`)
      setNote(parts.join(" "))
      await load(true)
      // The banner refetches its own findings above, but the PAGE is server-rendered: product rows,
      // provider chips and the store-liveness panel all come from the server component and would
      // keep showing pre-sync state until a manual reload. Refresh so the whole surface reflects the
      // write that just happened.
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (findings === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-ink-500 py-3">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking for drift…
      </div>
    )
  }
  if (findings.length === 0 && !error) return null

  const byKind = findings.reduce<Record<string, Finding[]>>((acc, f) => {
    ;(acc[f.kind] ??= []).push(f)
    return acc
  }, {})

  return (
    <section className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden mb-5">
      <header className="px-5 py-3 border-b border-amber-200 flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-amber-900 inline-flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Needs attention ({findings.length})
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load(true)}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 border border-amber-300 rounded px-2 py-1 hover:bg-amber-100"
          >
            <RefreshCw className="w-3 h-3" /> Re-check
          </button>
          <button
            onClick={() => void syncAll()}
            disabled={busy}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-white bg-amber-700 rounded px-2.5 py-1 hover:bg-amber-800 disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Sync all
          </button>
        </div>
      </header>

      {note && <p role="status" className="text-xs text-emerald-800 bg-emerald-50 px-5 py-2">{note}</p>}
      {error && <p role="alert" className="text-xs text-red-800 bg-red-50 px-5 py-2">{error}</p>}

      <ul className="divide-y divide-amber-100">
        {Object.entries(byKind).map(([kind, items]) => (
          <li key={kind} className="px-5 py-3">
            <p className="text-xs font-bold text-amber-900">
              {KIND_LABEL[kind] ?? kind} <span className="font-normal">({items.length})</span>
            </p>
            <ul className="mt-1 space-y-1">
              {items.map((f, i) => (
                <li key={`${f.subject}-${i}`} className="text-[11px] text-amber-900/90">
                  <span className="font-mono">{f.subject}</span> — {f.detail}
                  <span className="block text-amber-700">→ {f.action_hint}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  )
}
