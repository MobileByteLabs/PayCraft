"use client"

import { useMemo } from "react"
import {
  DEFAULT_BANDS,
  ZERO_DECIMAL_CURRENCIES,
  type CountryBand,
} from "@/lib/pricing-template-data"
import { resolveTemplatePrices } from "@/lib/pricing-template"

export type PricingRowState = {
  locale: string
  amount_cents: number
  currency: string
  source: "manual" | "stripe" | "razorpay" | "fallback"
  override: boolean // true → user has opted out of template default
}

export type PricingMap = Record<string, PricingRowState>

/**
 * Per-locale pricing matrix editor. One row per country, with an
 * "Override" checkbox that — when off — falls back to the shipped
 * template band for that country (uses `resolveTemplatePrices` to
 * derive a suggested amount from the product's base USD price).
 */
export function LocaleMatrix({
  baseCents,
  rows,
  onChange,
}: {
  baseCents: number
  rows: PricingMap
  onChange: (next: PricingMap) => void
}) {
  // Union of shipped 30+ bands + any already-saved row (so a country
  // saved manually but not in DEFAULT_BANDS still renders).
  const countries = useMemo<CountryBand[]>(() => {
    const extra: CountryBand[] = Object.values(rows)
      .filter((r) => !DEFAULT_BANDS.some((b) => b.country === r.locale))
      .map((r) => ({
        country: r.locale,
        currency: r.currency,
        multiplier: 1,
        roundTo: ZERO_DECIMAL_CURRENCIES.has(r.currency) ? 100 : 99,
      }))
    return [...DEFAULT_BANDS, ...extra]
  }, [rows])

  const templateResolved = useMemo(
    () => resolveTemplatePrices(baseCents),
    [baseCents],
  )
  const templateByLocale = useMemo(() => {
    const m: Record<string, { amountCents: number; currency: string }> = {}
    templateResolved.forEach((r) => {
      m[r.country] = { amountCents: r.amountCents, currency: r.currency }
    })
    return m
  }, [templateResolved])

  function setRow(locale: string, patch: Partial<PricingRowState>) {
    const current: PricingRowState =
      rows[locale] ??
      ({
        locale,
        amount_cents:
          templateByLocale[locale]?.amountCents ?? Math.round(baseCents),
        currency:
          templateByLocale[locale]?.currency ??
          countries.find((c) => c.country === locale)?.currency ??
          "USD",
        source: "fallback",
        override: false,
      } satisfies PricingRowState)
    onChange({ ...rows, [locale]: { ...current, ...patch } })
  }

  return (
    <div className="bg-white border border-ink-200 rounded-xl overflow-hidden">
      <table className="w-full text-left">
        <thead className="bg-ink-50/50">
          <tr>
            <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold">
              Country
            </th>
            <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold">
              Override
            </th>
            <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold">
              Price (minor units)
            </th>
            <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold">
              Currency
            </th>
            <th className="px-4 py-3 text-[11px] uppercase tracking-wider text-ink-400 font-bold">
              Source
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-50">
          {countries.map((band) => {
            const saved = rows[band.country]
            const isOverride = saved?.override ?? false
            const effective =
              saved ??
              ({
                locale: band.country,
                amount_cents:
                  templateByLocale[band.country]?.amountCents ?? baseCents,
                currency: band.currency,
                source: "fallback",
                override: false,
              } satisfies PricingRowState)
            return (
              <tr key={band.country} className="hover:bg-ink-50/40">
                <td className="px-4 py-2 text-sm font-mono text-ink-700">
                  {band.country}
                </td>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={isOverride}
                    onChange={(e) =>
                      setRow(band.country, {
                        override: e.target.checked,
                        source: e.target.checked ? "manual" : "fallback",
                      })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    min={0}
                    disabled={!isOverride}
                    value={effective.amount_cents}
                    onChange={(e) =>
                      setRow(band.country, {
                        amount_cents: parseInt(e.target.value || "0", 10),
                      })
                    }
                    className={`w-28 rounded border px-2 py-1 text-sm tabular-nums ${
                      isOverride
                        ? "border-ink-300 bg-white"
                        : "border-ink-100 bg-ink-50/50 text-ink-400"
                    }`}
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    maxLength={3}
                    disabled={!isOverride}
                    value={effective.currency}
                    onChange={(e) =>
                      setRow(band.country, {
                        currency: e.target.value.toUpperCase(),
                      })
                    }
                    className={`w-16 rounded border px-2 py-1 text-sm font-mono uppercase ${
                      isOverride
                        ? "border-ink-300 bg-white"
                        : "border-ink-100 bg-ink-50/50 text-ink-400"
                    }`}
                  />
                </td>
                <td className="px-4 py-2">
                  <SourceBadge source={effective.source} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function SourceBadge({ source }: { source: PricingRowState["source"] }) {
  const styles: Record<PricingRowState["source"], string> = {
    manual: "bg-brand-50 text-brand-700 border-brand-100",
    stripe: "bg-indigo-50 text-indigo-700 border-indigo-100",
    razorpay: "bg-emerald-50 text-emerald-700 border-emerald-100",
    fallback: "bg-ink-100 text-ink-500 border-ink-200",
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${styles[source]}`}
    >
      {source}
    </span>
  )
}
