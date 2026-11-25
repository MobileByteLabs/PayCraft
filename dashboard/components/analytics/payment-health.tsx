import { clsx } from "clsx"
import { DollarSign } from "lucide-react"
import { STAGE_LABEL, type AttemptStage } from "@/lib/attempts"
import type { AbandonStepKey, HealthBucket, PaymentHealth } from "@/lib/payment-health"

/**
 * Payment health (paycraft-attempt-observability AC-15 / AC-16) — mounted beside the paywall funnel on Analytics,
 * same window. Where attempts fail (by stage, provider, country), where buyers give up (by step), and how many
 * abandoned buyers the on-device resume reminder can reach. Definitions live in lib/payment-health.ts.
 */

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** A failure rate at or above this is drawn red. */
export const FAILURE_ALERT_RATE = 0.1
/** An abandon rate at or above this is drawn amber. */
export const ABANDON_ALERT_RATE = 0.5

const STEP_LABEL: Record<AbandonStepKey, string> = {
  plan_select: "Picked a plan",
  checkout_open: "Opened checkout",
  provider_result: "Provider replied",
}

function Meter({ rate, tone }: { rate: number; tone: "danger" | "warning" | "ink" }) {
  return (
    <span className="ml-3 inline-block h-1.5 w-16 overflow-hidden rounded-full bg-ink-100 align-middle" aria-hidden>
      <span
        className={clsx("block h-full rounded-full", tone === "danger" ? "bg-danger-500" : tone === "warning" ? "bg-warning-500" : "bg-ink-400")}
        style={{ width: `${Math.min(100, Math.max(rate > 0 ? 4 : 0, rate * 100))}%` }}
      />
    </span>
  )
}

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="border-b border-ink-100 px-6 py-4">
        <h4 className="text-base font-bold text-ink-900">{title}</h4>
        <p className="mt-0.5 text-[11px] text-ink-500">{sub}</p>
      </div>
      {children}
    </div>
  )
}

function Empty({ title }: { title: string }) {
  return (
    <div className="m-4 rounded-lg border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-400">
      {title}: no data in this range.
    </div>
  )
}

function RateTable(props: {
  title: string
  sub: string
  rows: HealthBucket[]
  label: (k: string) => string
  totalHeader: string
}) {
  return (
    <Panel title={props.title} sub={props.sub}>
      {props.rows.length === 0 ? (
        <Empty title={props.title} />
      ) : (
        <table className="w-full text-sm" aria-label={props.title}>
          <thead className="bg-ink-50 text-left text-[11px] font-bold uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-6 py-2">Key</th>
              <th className="px-3 py-2 text-right">{props.totalHeader}</th>
              <th className="px-3 py-2 text-right">Failed</th>
              <th className="px-6 py-2 text-right">Rate</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.slice(0, 8).map((r) => {
              const hot = r.rate >= FAILURE_ALERT_RATE
              return (
                <tr key={r.key} className="border-t border-ink-100">
                  <td className="px-6 py-2.5 font-medium text-ink-800">{props.label(r.key)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{r.total.toLocaleString()}</td>
                  <td className={clsx("px-3 py-2.5 text-right tabular-nums", r.failed > 0 ? "text-danger-700" : "text-ink-400")}>{r.failed.toLocaleString()}</td>
                  <td className="whitespace-nowrap px-6 py-2.5 text-right">
                    <span className={clsx("font-semibold tabular-nums", hot ? "text-danger-700" : "text-ink-900")} data-hot={hot || undefined}>{pct(r.rate)}</span>
                    <Meter rate={r.rate} tone={hot ? "danger" : "ink"} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Panel>
  )
}

/** A failure code in words, the code kept beside it so it can be searched and shared. */
const REASON_WORDS: Record<string, string> = {
  product_not_found: "Store had no such product",
  no_offer: "No offer this buyer can take",
  no_activity: "App was in the background",
  timeout: "Timed out",
  unknown: "Not reported (older SDK)",
}
const REASON_PREFIX_WORDS: Array<[string, string]> = [
  ["query_", "Store product lookup failed"],
  ["connect_", "Couldn't connect to the store"],
  ["launch_", "Store checkout didn't open"],
  ["purchase_", "Store declined the purchase"],
]
export function reasonLabel(code: string): string {
  const words = REASON_WORDS[code] ?? REASON_PREFIX_WORDS.find(([p]) => code.startsWith(p))?.[1]
  return code === "unknown" ? words! : words ? `${words} (${code})` : code
}

export function PaymentHealthPanel(props: {
  data: PaymentHealth
  days: number
  mode: "live" | "test"
  countryLabel: (cc: string) => string
  providerLabel: (p: string) => string
}) {
  const { data } = props
  const t = data.totals
  const stageLabel = (k: string) => STAGE_LABEL[k as AttemptStage] ?? "Unknown"
  return (
    <section className="space-y-6" aria-label="Payment health">
      <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-ink-900">Payment health</h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Every purchase attempt from plan pick to grant, last {props.days} days · {props.mode} mode
            </p>
          </div>
          {data.paidNotGranted > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-danger-50 px-3 py-1 text-xs font-bold text-danger-700 ring-1 ring-inset ring-danger-100">
              <DollarSign className="h-3.5 w-3.5" strokeWidth={2.5} />
              {data.paidNotGranted} paid, not granted
            </span>
          )}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-5">
          {[
            { k: "Attempts", v: t.attempts.toLocaleString(), tone: "text-ink-900" },
            { k: "Granted", v: t.attempts ? pct(t.grantRate) : "—", tone: "text-success-700" },
            { k: "Failed", v: (t.failed + t.paidNotGranted).toLocaleString(), tone: t.failed + t.paidNotGranted > 0 ? "text-danger-700" : "text-ink-900" },
            { k: "Abandoned", v: t.abandoned.toLocaleString(), tone: t.abandoned > 0 ? "text-warning-700" : "text-ink-900" },
            { k: "In flight", v: t.open.toLocaleString(), tone: "text-ink-900" },
          ].map((s) => (
            <div key={s.k} className="rounded-lg bg-ink-50 px-4 py-3">
              <dt className="text-[10px] font-bold uppercase tracking-widest text-ink-500">{s.k}</dt>
              <dd className={clsx("mt-1 text-xl font-extrabold tabular-nums", s.tone)}>{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RateTable title="Failure rate by stage" sub="Failures that ended at each stage, as a share of all attempts" rows={data.byStage} label={stageLabel} totalHeader="Of attempts" />
        <RateTable title="Why payments failed" sub="The reason the app or provider reported, as a share of all attempts" rows={data.byReason} label={reasonLabel} totalHeader="Of attempts" />
        <RateTable title="Failure rate by provider" sub="Failed or paid-not-granted, per provider's attempts" rows={data.byProvider} label={props.providerLabel} totalHeader="Attempts" />
        <RateTable title="Failure rate by country" sub="Country recorded server-side from the buyer's paywall events" rows={data.byCountry} label={props.countryLabel} totalHeader="Attempts" />
        <Panel title="Abandon rate by step" sub="Buyers who left with this as the furthest step, of those who reached it">
          {t.attempts === 0 ? (
            <Empty title="Abandon rate by step" />
          ) : (
            <ul className="divide-y divide-ink-100" aria-label="Abandon rate by step">
              {data.abandonByStep.map((r) => {
                const hot = r.rate >= ABANDON_ALERT_RATE
                return (
                  <li key={r.step} className="flex items-center gap-3 px-6 py-3 text-sm">
                    <span className="flex-1 font-medium text-ink-800">{STEP_LABEL[r.step]}</span>
                    <span className="tabular-nums text-ink-500">
                      {r.abandoned.toLocaleString()} / {r.reached.toLocaleString()}
                    </span>
                    <span className="w-28 whitespace-nowrap text-right">
                      <span className={clsx("font-semibold tabular-nums", hot ? "text-warning-700" : "text-ink-900")} data-hot={hot || undefined}>{pct(r.rate)}</span>
                      <Meter rate={r.rate} tone={hot ? "warning" : "ink"} />
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="border-t border-ink-100 px-6 py-3 text-xs text-ink-500" data-testid="nudge-reach">
            {data.nudge.reach === null ? (
              <>Nudge reach: no abandoned buyer was eligible for the on-device resume reminder in this range.</>
            ) : (
              <>
                Nudge reach: <span className="font-bold tabular-nums text-ink-900">{pct(data.nudge.reach)}</span> of eligible buyers received the
                on-device resume reminder ({data.nudge.scheduled.toLocaleString()} scheduled, {data.nudge.skippedNoPermission.toLocaleString()} without
                notification permission).
              </>
            )}
          </p>
        </Panel>
      </div>
    </section>
  )
}
