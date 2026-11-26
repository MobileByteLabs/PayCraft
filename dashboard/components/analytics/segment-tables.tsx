import React from "react"
import { clsx } from "clsx"
import type { JoinedSegmentRow } from "@/lib/analytics-joined"

/**
 * A joined segment table (paycraft-ga4-analytics-audit D3): GA4's users beside PayCraft's buyers and the purchases
 * providers confirmed, per platform / country / app version. GA4 sees every user who reached the paywall; PayCraft
 * counts its own events and the provider records — a GA4 column with no row reads "—", never 0.
 */
const num = (v: number | null) => (v === null ? "—" : v.toLocaleString())

export function SegmentTable({ title, rows, label, limit = 10 }: {
  title: string
  rows: JoinedSegmentRow[]
  label: (k: string) => string
  limit?: number
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="border-b border-ink-100 px-6 py-4">
        <h4 className="text-base font-bold text-ink-900">{title}</h4>
        <p className="mt-0.5 text-[11px] text-ink-500">GA4 users · PayCraft buyers · paid = confirmed by the provider</p>
      </div>
      {rows.length === 0 ? (
        <div className="m-4 rounded-lg border border-dashed border-ink-200 px-4 py-8 text-center text-sm text-ink-400">
          {title}: no data in this range.
        </div>
      ) : (
        <table className="w-full text-sm" aria-label={title}>
          <thead className="bg-ink-50 text-left text-[11px] font-bold uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-6 py-2">Segment</th>
              <th className="px-3 py-2 text-right">GA4 viewed</th>
              <th className="px-3 py-2 text-right">GA4 checkout</th>
              <th className="px-3 py-2 text-right">Viewed</th>
              <th className="px-3 py-2 text-right">Checkout</th>
              <th className="px-6 py-2 text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((r) => (
              <tr key={r.key} className="border-t border-ink-100">
                <td className="px-6 py-2.5 font-medium text-ink-800">{label(r.key)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{num(r.ga4Viewers)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{num(r.ga4Checkouts)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{r.viewers.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-ink-700">{r.checkouts.toLocaleString()}</td>
                <td className={clsx("px-6 py-2.5 text-right font-semibold tabular-nums", r.paid > 0 ? "text-success-700" : "text-ink-400")}>
                  {r.paid.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
