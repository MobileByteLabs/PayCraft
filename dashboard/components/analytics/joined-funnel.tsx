import React from "react"
import type { Ga4Status } from "@/lib/analytics-joined"
import type { FunnelStats } from "@/lib/funnel"
import { FunnelChart } from "@/components/analytics/funnel-chart"
import { funnelFromStats } from "@/lib/funnel"

/**
 * The paywall funnel twice, side by side (paycraft-ga4-analytics-audit D3/D4): what GA4 saw users do (its own users,
 * every app event) beside PayCraft's buyers with Paid = purchases the providers confirmed. They differ on purpose —
 * GA4's `purchase_success` is an app event a store purchase often never sends; the provider column is the revenue.
 */
const GA4_STEPS: Record<string, string> = {
  paycraft_paywall_view: "Viewed paywall",
  paycraft_plan_select: "Picked a plan",
  paycraft_checkout_start: "Started checkout",
  paycraft_purchase_success: "Purchase event (app)",
}

const FILTER_WORDS: Record<string, string> = { plan: "plan", app_version: "app version", platform: "platform", country: "country" }

const GA4_ABSENT: Record<Exclude<Ga4Status, "ok">, string> = {
  not_connected: "Connect GA4 below to see what users did in the app beside PayCraft's numbers.",
  not_set_up: "This PayCraft server has no GA4 reader configured.",
  error: "GA4 could not be read — see the Google Analytics section below.",
}

export function JoinedFunnel({ ga4, ga4Status, paycraft, notApplied, filtered = false }: {
  ga4: { event: string; users: number; events: number }[] | null
  ga4Status: Ga4Status
  paycraft: FunnelStats
  notApplied: { ga4: string[]; paid: string[] }
  /** A filter is on. With no matching events the empty state must not read as "this app sends nothing". */
  filtered?: boolean
}) {
  const top = ga4?.[0]?.users ?? 0
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
        <h4 className="text-base font-bold text-ink-900">What users did — GA4</h4>
        <p className="mt-0.5 text-[11px] text-ink-500">Users at each paywall step, from the app&apos;s own GA4 streams</p>
        {ga4 ? (
          <ul className="mt-5 space-y-3" aria-label="GA4 funnel">
            {ga4.map((s) => (
              <li key={s.event} className="flex items-center gap-3">
                <span className="w-40 shrink-0 text-sm font-medium text-ink-700">{GA4_STEPS[s.event] ?? s.event}</span>
                <span className="relative h-6 flex-1 overflow-hidden rounded bg-ink-50">
                  <span className="absolute inset-y-0 left-0 rounded bg-info-500" style={{ width: `${top ? Math.max(1, (s.users / top) * 100) : 0}%` }} />
                </span>
                <span className="w-16 text-right text-sm font-bold tabular-nums text-ink-900">{s.users.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-5 rounded-lg border border-dashed border-ink-200 px-4 py-6 text-sm text-ink-500">{GA4_ABSENT[ga4Status as Exclude<Ga4Status, "ok">]}</p>
        )}
        {notApplied.ga4.length > 0 && (
          <p className="mt-4 text-xs text-warning-700">
            GA4 is not filtered by {notApplied.ga4.map((f) => FILTER_WORDS[f] ?? f).join(", ")} — GA4 has no such dimension for PayCraft events.
          </p>
        )}
      </div>
      <div className="rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
        <h4 className="text-base font-bold text-ink-900">Buyers and revenue — PayCraft</h4>
        <p className="mt-0.5 text-[11px] text-ink-500">Distinct buyers at each step · Paid = purchases the providers confirmed</p>
        <div className="mt-5">
          {filtered && paycraft.viewed === 0 ? (
            // Events stored before the SDK sent a country / app version cannot match those filters; the provider
            // records can — so Paid is still shown, and the gap is named rather than read as "no events at all".
            <div className="rounded-lg border border-dashed border-ink-200 px-4 py-6 text-sm text-ink-600">
              <p className="font-semibold text-ink-800">No PayCraft paywall events match these filters.</p>
              <p className="mt-1 text-xs text-ink-500">
                Events recorded before the app sent its country and version can&apos;t match a country or version filter.
              </p>
              <p className="mt-3 text-sm">
                Paid — confirmed by the providers: <span className="font-bold tabular-nums text-success-700">{paycraft.paid.toLocaleString()}</span>
              </p>
            </div>
          ) : (
            <FunnelChart rows={funnelFromStats(paycraft)} />
          )}
        </div>
        {notApplied.paid.length > 0 && (
          <p className="mt-4 text-xs text-warning-700">
            Paid is not filtered by {notApplied.paid.map((f) => FILTER_WORDS[f] ?? f).join(", ")} — no provider record carries it.
          </p>
        )}
      </div>
    </div>
  )
}
