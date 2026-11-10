import Link from "next/link"
import { CalendarDays, Lock } from "lucide-react"
import { RANGE_OPTIONS, STAGE_LABEL, type FunnelRow, type SplitRow } from "@/lib/funnel"

const pct = (v: number | null, digits = 0) => (v === null ? "—" : `${(v * 100).toFixed(digits)}%`)

/**
 * The paywall funnel: one bar per stage, scaled to the first stage, with the drop from the stage before.
 * Server-rendered (no chart library): four bars read better as markup than as a canvas, and they print.
 */
export function FunnelChart({ rows }: { rows: FunnelRow[] }) {
  const top = rows[0]?.users ?? 0
  if (top === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-ink-200 px-6 text-center">
        <p className="text-sm font-medium text-ink-700">No paywall events yet</p>
        <p className="mt-1 max-w-sm text-xs text-ink-500">
          Update your app to PayCraft 3.1 (and the website SDK) to start the funnel. Nothing here is estimated.
        </p>
      </div>
    )
  }
  return (
    <ol className="space-y-3" aria-label="Paywall funnel">
      {rows.map((r, i) => (
        <li key={r.stage} className="grid grid-cols-[9.5rem_1fr_auto] items-center gap-3 text-sm">
          <span className="font-semibold text-ink-800">{STAGE_LABEL[r.stage]}</span>
          <span className="h-7 rounded-md bg-ink-50" aria-hidden="true">
            <span
              className={`block h-7 rounded-md ${i === rows.length - 1 ? "bg-success-500" : "bg-brand-500"}`}
              style={{ width: `${Math.max(2, (r.users / top) * 100)}%` }}
            />
          </span>
          <span className="flex min-w-[9rem] items-baseline justify-end gap-2 tabular-nums">
            <span className="font-bold text-ink-900">{r.users.toLocaleString()}</span>
            {r.dropFromPrev !== null && <span className="text-xs font-semibold text-danger-600">−{pct(r.dropFromPrev)}</span>}
            {i === rows.length - 1 && <span className="text-xs text-ink-500">{pct(r.ofFirst, 1)} overall</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Viewers → checkout → paid per country, or checkout → paid per provider (`base="checkouts"`: a buyer has no
 * provider until they choose one, so "viewed" means nothing there). Top rows, the rest folded into "Other".
 */
export function SplitTable({ title, rows, label, base = "viewers" }: {
  title: string
  rows: SplitRow[]
  label: (key: string) => string
  base?: "viewers" | "checkouts"
}) {
  const TOP = 8
  const byViewers = base === "viewers"
  const relevant = byViewers ? rows : rows.filter((r) => r.checkouts > 0 || r.payers > 0).sort((a, b) => b.checkouts - a.checkouts)
  const shown = relevant.slice(0, TOP)
  const rest = relevant.slice(TOP)
  if (rest.length) {
    shown.push(rest.reduce((a, r) => ({ ...a, viewers: a.viewers + r.viewers, checkouts: a.checkouts + r.checkouts, payers: a.payers + r.payers }),
      { key: "__other", viewers: 0, checkouts: 0, payers: 0 }))
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm">
      <div className="border-b border-ink-100 px-6 py-4">
        <h3 className="text-base font-bold tracking-tight text-ink-900">{title}</h3>
      </div>
      {shown.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-ink-400">No data in this range.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink-100 bg-ink-50 text-[11px] font-bold uppercase tracking-widest text-ink-500">
              <th className="px-6 py-2.5" scope="col">{title.replace(/^By /, "")}</th>
              {byViewers && <th className="px-3 py-2.5 text-right" scope="col">Viewed</th>}
              <th className="px-3 py-2.5 text-right" scope="col">Checkout</th>
              <th className="px-6 py-2.5 text-right" scope="col">Paid</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {shown.map((r) => (
              <tr key={r.key}>
                <td className="px-6 py-3 font-semibold text-ink-900">{r.key === "__other" ? "Other" : label(r.key)}</td>
                {byViewers && <td className="px-3 py-3 text-right tabular-nums text-ink-700">{r.viewers.toLocaleString()}</td>}
                <td className="px-3 py-3 text-right tabular-nums text-ink-700">{r.checkouts.toLocaleString()}</td>
                <td className="px-6 py-3 text-right tabular-nums">
                  <span className="font-semibold text-ink-900">{r.payers.toLocaleString()}</span>
                  {(byViewers ? r.viewers : r.checkouts) > 0 && (
                    <span className="ml-2 text-xs text-ink-500">{pct(r.payers / (byViewers ? r.viewers : r.checkouts), 1)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/**
 * The range menu — 7 / 30 / 90 days as links (`?range=`), so it works without client JavaScript. Ranges beyond
 * the plan's analytics retention are shown locked with an upgrade link instead of silently returning less data.
 */
export function RangeMenu({ days, retentionDays }: { days: number; retentionDays: number }) {
  return (
    <details className="relative flex-shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm font-semibold text-ink-700 shadow-sm hover:border-ink-300">
        <CalendarDays className="h-4 w-4" strokeWidth={2} />
        <span>Last {days} days</span>
      </summary>
      <div className="absolute right-0 z-10 mt-2 w-48 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
        {RANGE_OPTIONS.map((d) =>
          d > retentionDays ? (
            <Link key={d} href="/billing" className="flex items-center justify-between px-4 py-2 text-sm text-ink-400 hover:bg-ink-50">
              Last {d} days <Lock className="h-3.5 w-3.5" aria-label="Upgrade to unlock" />
            </Link>
          ) : (
            <Link key={d} href={`?range=${d}`} className={`block px-4 py-2 text-sm hover:bg-ink-50 ${d === days ? "font-bold text-brand-700" : "text-ink-700"}`}>
              Last {d} days
            </Link>
          ),
        )}
      </div>
    </details>
  )
}
