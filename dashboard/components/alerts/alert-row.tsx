"use client"

import { clsx } from "clsx"
import { Check, CheckCircle2, Loader2, XCircle, Clock } from "lucide-react"
import { STAGE_LABEL, type AttemptStage } from "@/lib/attempts"
import { alertKindLabel, type AlertDelivery, type AlertRow as Alert } from "@/lib/alerts"

const CHANNEL_LABEL: Record<AlertDelivery["channel"], string> = { email: "Email", slack: "Slack", webhook: "Webhook", inbox: "Inbox" }

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"

function SeverityChip({ alert }: { alert: Alert }) {
  if (alert.kind === "channel_test")
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-600 ring-1 ring-inset ring-ink-200">Test</span>
  if (alert.severity === "critical")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-danger-700 ring-1 ring-inset ring-danger-100">
        <span className="h-1.5 w-1.5 rounded-full bg-danger-500" aria-hidden />
        Critical
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-info-50 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-info-700 ring-1 ring-inset ring-info-100">
      <span className="h-1.5 w-1.5 rounded-full bg-info-500" aria-hidden />
      Digest
    </span>
  )
}

function DeliveryChip({ d }: { d: AlertDelivery }) {
  const Icon = d.status === "sent" ? CheckCircle2 : d.status === "failed" ? XCircle : Clock
  const tone = d.status === "sent" ? "text-success-700" : d.status === "failed" ? "text-danger-700" : "text-warning-700"
  const title = d.status === "failed"
    ? `${CHANNEL_LABEL[d.channel]} failed after ${d.attempts} ${d.attempts === 1 ? "try" : "tries"}${d.error ? `: ${d.error}` : ""}`
    : d.status === "pending" ? `${CHANNEL_LABEL[d.channel]} will retry` : `${CHANNEL_LABEL[d.channel]} delivered`
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 text-[11px] font-semibold", tone)}>
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {CHANNEL_LABEL[d.channel]}
      {d.status === "failed" && d.http_status ? <span className="font-mono">{d.http_status}</span> : null}
    </span>
  )
}

export function AlertRow({ alert, busy, onMarkRead }: { alert: Alert; busy: boolean; onMarkRead: (id: string) => void }) {
  const unread = alert.read_at === null
  return (
    <li
      data-alert-id={alert.id}
      data-unread={unread || undefined}
      className={clsx(
        "relative px-6 py-4 transition-opacity",
        unread ? "bg-white" : "bg-ink-50/40 opacity-70",
        unread && alert.severity === "critical" && "before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-danger-500",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityChip alert={alert} />
        <span className={clsx("text-sm text-ink-900", unread ? "font-bold" : "font-semibold")}>{alert.title}</span>
        {alert.stage && (
          <span className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-700 ring-1 ring-inset ring-ink-200">
            {STAGE_LABEL[alert.stage as AttemptStage] ?? alert.stage}
            {alert.code ? <span className="font-mono"> · {alert.code}</span> : null}
          </span>
        )}
        {alert.correlation && (
          <span
            title={alert.correlation === "inferred" ? "Matched to the payment by rule, not by attempt id" : "Matched by attempt id"}
            className={clsx(
              "rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
              alert.correlation === "exact" ? "bg-success-50 text-success-700 ring-success-100" : "bg-warning-50 text-warning-700 ring-warning-100",
            )}
          >
            {alert.correlation}
          </span>
        )}
        {!unread && (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-ink-400">
            <Check className="h-3 w-3" strokeWidth={2.5} /> Read
          </span>
        )}
      </div>
      <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wider text-ink-400">{alertKindLabel(alert.kind)}</p>
      {alert.body && <p className="mt-1.5 whitespace-pre-line text-sm text-ink-700">{alert.body}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs tabular-nums text-ink-500">{fmt(alert.created_at)}</span>
        {alert.deliveries.length > 0 && (
          <span className="flex flex-wrap items-center gap-3" aria-label="Deliveries">
            {alert.deliveries.map((d) => <DeliveryChip key={d.channel} d={d} />)}
          </span>
        )}
        {unread && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onMarkRead(alert.id)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-1 text-xs font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" strokeWidth={2.5} />}
            Mark read
          </button>
        )}
      </div>
    </li>
  )
}
