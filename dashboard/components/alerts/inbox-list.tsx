"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { BellOff, CheckCheck, Loader2 } from "lucide-react"
import type { AlertRow as Alert } from "@/lib/alerts"
import { AlertRow } from "./alert-row"
import { announceAlertsRead } from "./unread-badge"

/**
 * The inbox list. Mark read POSTs, updates the row in place, then refreshes the server components so the
 * sidebar badge (read in the layout) shows the new unread count.
 */
export function InboxList({ alerts, filtered }: { alerts: Alert[]; filtered: boolean }) {
  const router = useRouter()
  const [rows, setRows] = useState(alerts)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, startRefresh] = useTransition()
  const [seen, setSeen] = useState(alerts)
  if (seen !== alerts) {
    // New server data (filter change / refresh) replaces local optimistic state.
    setSeen(alerts)
    setRows(alerts)
  }

  const unread = rows.filter((r) => r.read_at === null).length

  async function markRead(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await fetch(`/api/alerts/${id}/read`, { method: "POST" })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`)
      const at = new Date().toISOString()
      const target = rows.find((r) => r.id === id)
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, read_at: at } : r)))
      if (target && target.read_at === null) {
        announceAlertsRead({ total: 1, critical: target.severity === "critical" ? 1 : 0 })
      }
      startRefresh(() => router.refresh())
    } catch (e) {
      setError(`Couldn't mark it read: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  async function markAll() {
    setBusyId("*")
    setError(null)
    try {
      const res = await fetch("/api/alerts/read-all", { method: "POST" })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`)
      const at = new Date().toISOString()
      // read-all reads every unread alert of the app, not just this (possibly filtered) page — the server
      // count after router.refresh() is authoritative; locally drop what this page can see.
      const unreadHere = rows.filter((r) => r.read_at === null)
      setRows((rs) => rs.map((r) => (r.read_at ? r : { ...r, read_at: at })))
      announceAlertsRead({ total: unreadHere.length, critical: unreadHere.filter((r) => r.severity === "critical").length })
      startRefresh(() => router.refresh())
    } catch (e) {
      setError(`Couldn't mark all read: ${(e as Error).message}`)
    } finally {
      setBusyId(null)
    }
  }

  if (!rows.length)
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <BellOff className="mx-auto mb-3 h-6 w-6 text-ink-300" strokeWidth={1.75} />
        <p className="text-sm font-semibold text-ink-700">{filtered ? "Nothing matches this filter." : "No alerts yet."}</p>
        <p className="mt-1 text-xs text-ink-500">
          You'll see critical incidents here immediately and digests every hour.
        </p>
      </div>
    )

  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-ink-100 px-6 py-3">
        <p className="text-xs font-semibold text-ink-500">
          <span className="tabular-nums text-ink-900">{unread}</span> unread of <span className="tabular-nums">{rows.length}</span>
          {refreshing && <Loader2 className="ml-2 inline h-3 w-3 animate-spin text-ink-400" />}
        </p>
        <button
          type="button"
          disabled={unread === 0 || busyId !== null}
          onClick={markAll}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 disabled:cursor-not-allowed disabled:text-ink-300"
        >
          <CheckCheck className="h-3.5 w-3.5" strokeWidth={2.5} /> Mark all read
        </button>
      </div>
      {error && <p role="alert" className="border-b border-danger-100 bg-danger-50 px-6 py-2 text-xs text-danger-700">{error}</p>}
      <ul className="divide-y divide-ink-100" aria-label="Alerts">
        {rows.map((a) => (
          <AlertRow key={a.id} alert={a} busy={busyId === a.id || busyId === "*"} onMarkRead={markRead} />
        ))}
      </ul>
    </div>
  )
}
