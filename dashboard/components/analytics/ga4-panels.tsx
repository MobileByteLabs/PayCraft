// The connected GA4 property's numbers next to PayCraft's own funnel (paycraft-paywall-analytics T16): totals, users
// per day, and PayCraft's paywall events by country. Where Google withholds small counts (thresholding / "(other)")
// the panel says so — it never shows those as 0.

import { Info } from "lucide-react"
import type { Ga4Overview } from "@/lib/ga4"

type Ok = Extract<Ga4Overview, { ok: true }>

const fmt = (v: number) => v.toLocaleString("en-US")

function Withheld({ what }: { what: string }) {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-500" data-testid="ga4-withheld">
      <Info className="mt-0.5 h-3.5 w-3.5 flex-none" />
      Some {what} are withheld by Google (small counts are hidden to protect users' privacy) — totals here may be lower than reality.
    </p>
  )
}

function UsersLine({ points }: { points: { date: string; users: number }[] }) {
  if (points.length < 2) return <p className="text-sm text-ink-500">Not enough days of data yet.</p>
  const w = 600, h = 140, pad = 6
  const max = Math.max(...points.map((p) => p.users), 1)
  const xy = points.map((p, i) => [pad + (i * (w - 2 * pad)) / (points.length - 1), h - pad - (p.users / max) * (h - 2 * pad)] as const)
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  return (
    <figure>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-36 w-full" role="img" aria-label={`Active users per day, ${points[0].date} to ${points[points.length - 1].date}`}>
        <polygon points={`${pad},${h - pad} ${line} ${w - pad},${h - pad}`} className="fill-brand-500/10" />
        <polyline points={line} fill="none" className="stroke-brand-600" strokeWidth={2} strokeLinejoin="round" />
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] tabular-nums text-ink-400">
        <span>{points[0].date}</span><span>peak {fmt(max)}</span><span>{points[points.length - 1].date}</span>
      </figcaption>
    </figure>
  )
}

export function Ga4Panels({ data, days }: { data: Ok; days: number }) {
  const tiles = [
    { label: "Active users", value: data.totals.activeUsers },
    { label: "Sessions", value: data.totals.sessions },
    { label: "paycraft_paywall_view", value: data.totals.paywallViews, mono: true },
  ]
  return (
    <div className="grid gap-6" data-testid="ga4-panels">
      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-ink-200 p-4">
            <p className={`text-xs font-bold uppercase tracking-widest text-ink-500 ${t.mono ? "font-mono normal-case tracking-normal" : ""}`}>{t.label}</p>
            <p className="mt-2 text-2xl font-extrabold tabular-nums text-ink-900">{fmt(t.value)}</p>
          </div>
        ))}
      </div>
      {data.totalsWithheld && <Withheld what="users" />}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-ink-200 p-4">
          <h4 className="mb-3 text-sm font-semibold text-ink-900">Active users per day <span className="font-normal text-ink-400">· last {days} days</span></h4>
          <UsersLine points={data.daily} />
        </div>
        <div className="rounded-lg border border-ink-200 p-4">
          <h4 className="mb-3 text-sm font-semibold text-ink-900">PayCraft events by country</h4>
          {data.events.length === 0 ? (
            <p className="text-sm text-ink-500">No paycraft_* events in GA4 yet — wire the SDK&apos;s analytics listener to your GA4 / Firebase Analytics.</p>
          ) : (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-sm" aria-label="PayCraft events by country">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-ink-500"><th className="pb-2">Event</th><th className="pb-2">Country</th><th className="pb-2 text-right">Count</th></tr>
                </thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={`${e.event}:${e.country}`} className="border-t border-ink-100">
                      <td className="py-1.5 font-mono text-xs">{e.event}</td>
                      <td className="py-1.5">{e.country === "(other)" ? <span className="text-ink-400">withheld by Google</span> : e.country}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(e.count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.eventsWithheld && <Withheld what="rows" />}
        </div>
      </div>
    </div>
  )
}
