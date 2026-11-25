"use client"

import { useEffect, useState } from "react"
import { clsx } from "clsx"

/** Fired by the inbox after alerts are marked read: how many left the unread set, and how many of those were critical. */
export const ALERTS_READ_EVENT = "paycraft:alerts-read"
export type AlertsReadDetail = { total: number; critical: number }

export function announceAlertsRead(detail: AlertsReadDetail) {
  if (detail.total > 0) window.dispatchEvent(new CustomEvent<AlertsReadDetail>(ALERTS_READ_EVENT, { detail }))
}

/**
 * The sidebar's unread-alerts pill. Red when at least one unread alert is critical, grey when they are all
 * digests; nothing at all when everything is read. The counts are read server-side in the dashboard layout on
 * every navigation; Mark read in the inbox announces what it read so the pill drops at once instead of waiting
 * for the layout refresh, and the next server count (props change) replaces the local one.
 */
export function UnreadBadge({ count, critical }: { count: number; critical: number }) {
  const [live, setLive] = useState({ count, critical })

  useEffect(() => {
    setLive({ count, critical })
  }, [count, critical])

  useEffect(() => {
    function onRead(e: Event) {
      const d = (e as CustomEvent<AlertsReadDetail>).detail
      setLive((cur) => ({ count: Math.max(0, cur.count - d.total), critical: Math.max(0, cur.critical - d.critical) }))
    }
    window.addEventListener(ALERTS_READ_EVENT, onRead)
    return () => window.removeEventListener(ALERTS_READ_EVENT, onRead)
  }, [])

  if (live.count <= 0) return null
  return (
    <span
      data-testid="alerts-unread-badge"
      data-critical={live.critical > 0 || undefined}
      aria-label={`${live.count} unread ${live.count === 1 ? "alert" : "alerts"}${live.critical > 0 ? `, ${live.critical} critical` : ""}`}
      className={clsx(
        "ml-auto inline-flex h-4 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums",
        live.critical > 0 ? "bg-danger-100 text-danger-700" : "bg-ink-100 text-ink-700",
      )}
    >
      {live.count > 99 ? "99+" : live.count}
    </span>
  )
}
