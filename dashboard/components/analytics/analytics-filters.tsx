import React from "react"
import Link from "next/link"

/**
 * The Analytics filter bar (paycraft-ga4-analytics-audit D3): platform / country / app version / plan, applied to the
 * GA4 report, the provider-truth funnel and Payment health alike. A GET form, so it works without client JavaScript
 * and every filtered view is a shareable URL; the range rides along as a hidden field.
 */
export type FilterValue = { platform?: string; country?: string; appVersion?: string; plan?: string }

export function AnalyticsFilters({ days, value, options }: {
  days: number
  value: FilterValue
  options: { platforms: string[]; countries: string[]; appVersions: string[]; plans: string[] }
}) {
  const any = Boolean(value.platform || value.country || value.appVersion || value.plan)
  const field = (name: string, label: string, current: string | undefined, values: string[], show: (v: string) => string = (v) => v) => (
    <label className="flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-ink-500">
      {label}
      <select
        name={name}
        defaultValue={current ?? ""}
        className="min-w-[9rem] rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-ink-800"
      >
        <option value="">All</option>
        {/* A value only the URL names (no rows yet) still shows as chosen rather than silently reading "All". */}
        {[...new Set([...(current ? [current] : []), ...values])].map((v) => (
          <option key={v} value={v}>{show(v)}</option>
        ))}
      </select>
    </label>
  )
  return (
    <form method="get" aria-label="Analytics filters" className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-200 bg-white p-4 shadow-sm">
      <input type="hidden" name="range" value={days} />
      {field("platform", "Platform", value.platform, options.platforms, (v) => v === "ios" ? "iOS" : v.charAt(0).toUpperCase() + v.slice(1))}
      {field("country", "Country", value.country, options.countries)}
      {field("app_version", "App version", value.appVersion, options.appVersions)}
      {field("plan", "Plan", value.plan, options.plans)}
      <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
        Apply
      </button>
      {any && (
        <Link href={`?range=${days}`} className="px-2 py-2 text-sm font-medium text-ink-500 hover:text-ink-800">
          Clear filters
        </Link>
      )}
    </form>
  )
}
