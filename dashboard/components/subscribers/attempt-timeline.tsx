import { AlertTriangle, CheckCircle2, Clock, DollarSign, Link2, XCircle, type LucideIcon } from "lucide-react"
import { clsx } from "clsx"
import {
  STAGE_LABEL,
  eventLabel,
  failingEvent,
  isFailureState,
  type AttemptEventRow,
  type AttemptRow,
  type AttemptState,
} from "@/lib/attempts"

/**
 * One buyer's purchase attempts, newest first (paycraft-attempt-observability AC-15 / AC-16). Each attempt is a
 * card: a colour-coded state chip, the failing stage + code when it failed, how it was correlated (exact
 * attempt id, or inferred by a named rule), then its steps in order with the failing step marked red.
 */

type Tone = { chip: string; icon: LucideIcon; label: string; dot: string }

const STATE_TONE: Record<AttemptState, Tone> = {
  started: { chip: "bg-ink-100 text-ink-700 ring-ink-200", icon: Clock, label: "In progress", dot: "bg-ink-300" },
  checkout_opened: { chip: "bg-ink-100 text-ink-700 ring-ink-200", icon: Clock, label: "Checkout open", dot: "bg-ink-300" },
  provider_result: { chip: "bg-info-50 text-info-700 ring-info-100", icon: Clock, label: "Awaiting grant", dot: "bg-info-500" },
  granted: { chip: "bg-success-50 text-success-700 ring-success-100", icon: CheckCircle2, label: "Granted", dot: "bg-success-500" },
  failed: { chip: "bg-danger-50 text-danger-700 ring-danger-100", icon: XCircle, label: "Failed", dot: "bg-danger-500" },
  abandoned: { chip: "bg-warning-50 text-warning-700 ring-warning-100", icon: AlertTriangle, label: "Abandoned", dot: "bg-warning-500" },
  paid_not_granted: { chip: "bg-danger-100 text-danger-700 ring-danger-500 font-extrabold", icon: DollarSign, label: "Paid, not granted", dot: "bg-danger-600" },
}

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC"
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "UTC" })

function duration(from: string, to: string | null): string | null {
  if (!to) return null
  const s = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`
}

const providerName = (p: string) => p.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

function StagePill({ stage, code }: { stage: keyof typeof STAGE_LABEL; code: string | null }) {
  return (
    <span className="inline-flex items-center rounded-md bg-danger-50 px-2 py-0.5 text-[11px] font-semibold text-danger-700 ring-1 ring-inset ring-danger-100">
      {STAGE_LABEL[stage]}
      {code ? <span className="font-mono">&nbsp;· {code}</span> : null}
    </span>
  )
}

function CorrelationPill({ a }: { a: AttemptRow }) {
  if (a.correlation === "exact")
    return (
      <span title="Exact — the attempt id travelled with the payment to the provider and back" className="rounded-md bg-success-50 px-2 py-0.5 text-[11px] font-semibold text-success-700 ring-1 ring-inset ring-success-100">
        exact
      </span>
    )
  if (a.correlation === "inferred")
    return (
      <span title={`Inferred by rule: ${a.match_rule ?? "unknown"}`} className="rounded-md bg-warning-50 px-2 py-0.5 text-[11px] font-semibold text-warning-700 ring-1 ring-inset ring-warning-100">
        inferred
      </span>
    )
  return (
    <span title="Recorded before attempt tracking; not yet matched to a payment" className="rounded-md bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-600 ring-1 ring-inset ring-ink-200">
      uncorrelated
    </span>
  )
}

function Step({ e, failing, attemptState }: { e: AttemptEventRow; failing: boolean; attemptState: AttemptState }) {
  const isStateRow = e.event === attemptState
  const dot = failing
    ? "bg-danger-500 ring-4 ring-danger-100"
    : isStateRow
      ? STATE_TONE[attemptState].dot
      : e.error_class || e.error_code
        ? "bg-warning-500"
        : "bg-ink-300"
  return (
    <li className="relative pl-6" data-failing={failing || undefined}>
      <span className={clsx("absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full", dot)} aria-hidden />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className={clsx("font-semibold", failing ? "text-danger-700" : "text-ink-900")}>{eventLabel(e.event)}</span>
        {failing ? (
          <StagePill stage={e.stage} code={e.error_code} />
        ) : (
          <span className="text-[11px] font-medium text-ink-400">{STAGE_LABEL[e.stage]}</span>
        )}
        <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-400">{fmtTime(e.occurred_at)}</span>
      </div>
      {e.error_message && <p className={clsx("mt-0.5 text-xs", failing ? "text-danger-600" : "text-ink-500")}>{e.error_message}</p>}
    </li>
  )
}

export function AttemptTimeline({ attempts, error }: { attempts: AttemptRow[]; error?: string | null }) {
  if (error)
    return (
      <div role="alert" className="rounded-lg border border-danger-100 bg-danger-50 p-4 text-sm text-danger-700">
        Couldn't load payment attempts: {error}
      </div>
    )
  if (!attempts.length)
    return (
      <div className="rounded-lg border border-dashed border-ink-200 p-6 text-center">
        <p className="text-sm font-medium text-ink-700">No payment attempts yet for this subscriber.</p>
        <p className="mt-1 text-xs text-ink-500">Every plan pick, checkout and provider reply lands here as it happens.</p>
      </div>
    )
  return (
    <ol className="space-y-4" aria-label="Payment attempts">
      {attempts.map((a) => {
        const tone = STATE_TONE[a.state]
        const Icon = tone.icon
        const failing = failingEvent(a)
        const took = duration(a.started_at, a.closed_at)
        return (
          <li key={a.id} className="rounded-xl border border-ink-200 bg-white p-5" data-state={a.state}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", tone.chip)}>
                <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
                {tone.label}
              </span>
              {isFailureState(a.state) && a.stage && <StagePill stage={a.stage} code={a.error_code} />}
              <CorrelationPill a={a} />
              {a.mode === "test" && (
                <span className="rounded-md bg-warning-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-700">Test</span>
              )}
              <span className="ml-auto text-xs tabular-nums text-ink-500">{fmtDateTime(a.started_at)}</span>
            </div>
            <p className="mb-3 text-xs text-ink-500">
              {providerName(a.provider)}
              {a.plan ? <> · <span className="font-mono text-ink-700">{a.plan}</span></> : null}
              {took ? <> · took {took}</> : null}
              {a.attempt_id ? <> · <span className="font-mono text-ink-400" title={a.attempt_id}>{a.attempt_id.slice(0, 12)}…</span></> : null}
            </p>
            {a.correlation === "inferred" && (
              <div className="mb-3 flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700">
                <Link2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" strokeWidth={2} />
                <span>
                  <span className="font-semibold">Why this is inferred:</span> the payment reached the provider without an attempt id, so
                  PayCraft matched it by rule <span className="font-mono font-semibold">{a.match_rule ?? "unknown"}</span>.
                </span>
              </div>
            )}
            {a.events.length ? (
              <ul className="relative space-y-2.5 before:absolute before:bottom-2 before:left-[4.5px] before:top-2 before:w-px before:bg-ink-200">
                {a.events.map((e, i) => (
                  <Step key={`${e.occurred_at}-${i}`} e={e} failing={failing === e} attemptState={a.state} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-ink-400">
                No step-by-step timeline — this attempt was recorded before attempt tracking.
                {a.error_message ? <span className="block text-danger-600">{a.error_message}</span> : null}
              </p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
