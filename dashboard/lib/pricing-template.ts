import { DEFAULT_BANDS, ZERO_DECIMAL_CURRENCIES, type CountryBand } from "./pricing-template-data"

export type { CountryBand }

export interface ResolvedPrice {
  country: string
  currency: string
  amountCents: number  // minor units (or whole units for zero-decimal currencies)
}

/**
 * Compute suggested per-country prices from a USD reference amount.
 *
 * @param usdReferenceCents  Base price in USD cents (e.g. 999 = $9.99)
 * @param bands              Country bands to use (defaults to DEFAULT_BANDS)
 * @param overrides          Per-country manual overrides — country → {amountCents}
 */
export function resolveTemplatePrices(
  usdReferenceCents: number,
  bands: CountryBand[] = DEFAULT_BANDS,
  overrides: Record<string, { amountCents: number }> = {},
): ResolvedPrice[] {
  const usdDollars = usdReferenceCents / 100

  return bands.map((b) => {
    if (overrides[b.country]) {
      return {
        country: b.country,
        currency: b.currency,
        amountCents: overrides[b.country].amountCents,
      }
    }

    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(b.currency)
    // For zero-decimal currencies, multiplier already gives whole units.
    // For others, multiplier gives whole major units → convert to cents.
    const rawUnits = usdDollars * b.multiplier
    const minorUnits = isZeroDecimal ? rawUnits : rawUnits * 100

    // Round to the nearest band (e.g. roundTo=99 → ends in .99; roundTo=100 → nearest 100)
    const snapped = Math.round(minorUnits / b.roundTo) * b.roundTo
    // Ensure at least one full band unit
    const finalAmount = Math.max(snapped, b.roundTo)

    return { country: b.country, currency: b.currency, amountCents: finalAmount }
  })
}

/**
 * Find a resolved price for a specific country, falling back to US.
 */
export function resolvePriceForCountry(
  country: string,
  usdReferenceCents: number,
  bands: CountryBand[] = DEFAULT_BANDS,
  overrides: Record<string, { amountCents: number }> = {},
): ResolvedPrice {
  const all = resolveTemplatePrices(usdReferenceCents, bands, overrides)
  return all.find((r) => r.country === country) ?? all.find((r) => r.country === "US")!
}
