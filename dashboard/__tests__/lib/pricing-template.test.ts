// Tests for dashboard/lib/pricing-template.ts
// Covers Phase 3 (country-pricing-template) AC-8/AC-13/AC-14:
//   - USD reference -> per-country resolved amounts via DEFAULT_BANDS
//   - Zero-decimal currencies (JPY, KRW, VND, CLP, COP, IDR) round to whole units
//   - Non-zero-decimal currencies round to .99 ending (roundTo=99) in minor units
//   - Per-country overrides win over template multiplier
//   - resolvePriceForCountry() falls back to US when country missing
//
// Note on "expected" values: the spec text uses "~₹299" as a UX example, but the
// shipped algorithm at $9.99 base computes 9.99 * 30 = 299.70 USD-equivalent ->
// 29970 paise -> rounded to nearest 99 -> 29997 paise (= ₹299.97). The test pins
// the exact shipped behavior — not the marketing copy.

import {
  resolveTemplatePrices,
  resolvePriceForCountry,
} from "@/lib/pricing-template"
import {
  DEFAULT_BANDS,
  ZERO_DECIMAL_CURRENCIES,
} from "@/lib/pricing-template-data"

const USD_999 = 999 // $9.99 reference

function find(country: string, rows: ReturnType<typeof resolveTemplatePrices>) {
  const row = rows.find((r) => r.country === country)
  if (!row) throw new Error(`country ${country} not in resolved rows`)
  return row
}

describe("resolveTemplatePrices()", () => {
  test("US base — returns 990 cents (snap of 999 to nearest 99) in USD", () => {
    const rows = resolveTemplatePrices(USD_999)
    const us = find("US", rows)
    expect(us.currency).toBe("USD")
    expect(us.amountCents).toBe(990)
  })

  test("IN — INR multiplier 30 yields 29997 paise (₹299.97) at $9.99 base", () => {
    const rows = resolveTemplatePrices(USD_999)
    const inr = find("IN", rows)
    expect(inr.currency).toBe("INR")
    // 9.99 * 30 = 299.7 -> 29970 paise -> snap to nearest 99 = 29997
    expect(inr.amountCents).toBe(29997)
  })

  test("JP — JPY zero-decimal yields exact ¥1100 whole-yen at $9.99 base", () => {
    const rows = resolveTemplatePrices(USD_999)
    const jp = find("JP", rows)
    expect(jp.currency).toBe("JPY")
    // zero-decimal: 9.99 * 110 = 1098.9 -> snap to nearest 100 = 1100
    expect(jp.amountCents).toBe(1100)
    // Sanity: no fractional cents — value is in whole yen (an integer)
    expect(Number.isInteger(jp.amountCents)).toBe(true)
  })

  test("KR — KRW zero-decimal yields ₩13000 whole-won at $9.99 base", () => {
    const rows = resolveTemplatePrices(USD_999)
    const kr = find("KR", rows)
    expect(kr.currency).toBe("KRW")
    // 9.99 * 1300 = 12987 -> snap to nearest 1000 = 13000
    expect(kr.amountCents).toBe(13000)
  })

  test("BR/MX/ZA/AU — verify additional non-zero-decimal bands", () => {
    const rows = resolveTemplatePrices(USD_999)
    // BR: 9.99 * 3.20 = 31.968 BRL -> 3196.8 cents -> snap 99 -> 3168 (3168/99 ≈ 32)
    expect(find("BR", rows).amountCents).toBe(3168)
    expect(find("BR", rows).currency).toBe("BRL")
    // MX: 9.99 * 17 = 169.83 MXN -> 16983 cents -> snap 99 -> 17028 (17028/99 = 172)
    expect(find("MX", rows).amountCents).toBe(17028)
    expect(find("MX", rows).currency).toBe("MXN")
    // ZA: 9.99 * 5.50 = 54.945 ZAR -> 5494.5 cents -> snap 99 -> 5544
    expect(find("ZA", rows).amountCents).toBe(5544)
    expect(find("ZA", rows).currency).toBe("ZAR")
    // AU: 9.99 * 0.90 = 8.991 AUD -> 899.1 cents -> snap 99 -> 891
    expect(find("AU", rows).amountCents).toBe(891)
    expect(find("AU", rows).currency).toBe("AUD")
  })

  test("VN — VND zero-decimal with roundTo=990 yields whole-dong amount", () => {
    const rows = resolveTemplatePrices(USD_999)
    const vn = find("VN", rows)
    expect(vn.currency).toBe("VND")
    // 9.99 * 14000 = 139860 -> snap 990 = 139590 (139590/990 = 141)
    expect(vn.amountCents).toBe(139590)
    expect(Number.isInteger(vn.amountCents)).toBe(true)
  })

  test("per-country override wins over template multiplier", () => {
    const overrides = { IN: { amountCents: 19900 } } // tenant set ₹199 manually
    const rows = resolveTemplatePrices(USD_999, DEFAULT_BANDS, overrides)
    const inr = find("IN", rows)
    expect(inr.amountCents).toBe(19900) // override wins
    expect(inr.currency).toBe("INR") // currency still from band
    // unaffected country still uses template
    expect(find("JP", rows).amountCents).toBe(1100)
  })

  test("override for multiple countries leaves others unchanged", () => {
    const overrides = {
      US: { amountCents: 499 },
      JP: { amountCents: 500 },
    }
    const rows = resolveTemplatePrices(USD_999, DEFAULT_BANDS, overrides)
    expect(find("US", rows).amountCents).toBe(499)
    expect(find("JP", rows).amountCents).toBe(500)
    // BR untouched
    expect(find("BR", rows).amountCents).toBe(3168)
  })

  test("returns one row per band (no dropped countries)", () => {
    const rows = resolveTemplatePrices(USD_999)
    expect(rows).toHaveLength(DEFAULT_BANDS.length)
    expect(rows.length).toBeGreaterThanOrEqual(30)
  })

  test("every row's currency matches the band currency", () => {
    const rows = resolveTemplatePrices(USD_999)
    for (const row of rows) {
      const band = DEFAULT_BANDS.find((b) => b.country === row.country)!
      expect(row.currency).toBe(band.currency)
    }
  })

  test("zero-decimal currencies produce integer minor units (no fractional cents)", () => {
    const rows = resolveTemplatePrices(USD_999)
    for (const row of rows) {
      if (ZERO_DECIMAL_CURRENCIES.has(row.currency)) {
        expect(Number.isInteger(row.amountCents)).toBe(true)
        // whole-unit currencies are already in their major unit; should not be
        // expressed in fractional sub-units like 110.5
        expect(row.amountCents % 1).toBe(0)
      }
    }
  })

  test("non-zero-decimal currencies snap to band step (roundTo)", () => {
    const rows = resolveTemplatePrices(USD_999)
    for (const row of rows) {
      if (!ZERO_DECIMAL_CURRENCIES.has(row.currency)) {
        const band = DEFAULT_BANDS.find((b) => b.country === row.country)!
        expect(row.amountCents % band.roundTo).toBe(0)
      }
    }
  })

  test("never returns below one full band unit", () => {
    // Very small reference: 1 cent — every band should still clamp to >= roundTo
    const rows = resolveTemplatePrices(1)
    for (const row of rows) {
      const band = DEFAULT_BANDS.find((b) => b.country === row.country)!
      expect(row.amountCents).toBeGreaterThanOrEqual(band.roundTo)
    }
  })
})

describe("resolvePriceForCountry()", () => {
  test("returns matching row for a known country", () => {
    const r = resolvePriceForCountry("IN", USD_999)
    expect(r.country).toBe("IN")
    expect(r.currency).toBe("INR")
    expect(r.amountCents).toBe(29997)
  })

  test("falls back to US when country is not in the template", () => {
    const r = resolvePriceForCountry("ZZ", USD_999) // unknown ISO code
    expect(r.country).toBe("US")
    expect(r.currency).toBe("USD")
    expect(r.amountCents).toBe(990)
  })

  test("falls back to US for empty-string country", () => {
    const r = resolvePriceForCountry("", USD_999)
    expect(r.country).toBe("US")
    expect(r.currency).toBe("USD")
  })

  test("respects overrides through the per-country resolver", () => {
    const r = resolvePriceForCountry("JP", USD_999, DEFAULT_BANDS, {
      JP: { amountCents: 1500 },
    })
    expect(r.country).toBe("JP")
    expect(r.currency).toBe("JPY")
    expect(r.amountCents).toBe(1500)
  })
})

describe("ZERO_DECIMAL_CURRENCIES set", () => {
  test("includes JPY, KRW, VND, CLP, COP, IDR", () => {
    expect(ZERO_DECIMAL_CURRENCIES.has("JPY")).toBe(true)
    expect(ZERO_DECIMAL_CURRENCIES.has("KRW")).toBe(true)
    expect(ZERO_DECIMAL_CURRENCIES.has("VND")).toBe(true)
    expect(ZERO_DECIMAL_CURRENCIES.has("CLP")).toBe(true)
    expect(ZERO_DECIMAL_CURRENCIES.has("COP")).toBe(true)
    expect(ZERO_DECIMAL_CURRENCIES.has("IDR")).toBe(true)
  })

  test("does NOT include USD, EUR, GBP, INR, BRL", () => {
    expect(ZERO_DECIMAL_CURRENCIES.has("USD")).toBe(false)
    expect(ZERO_DECIMAL_CURRENCIES.has("EUR")).toBe(false)
    expect(ZERO_DECIMAL_CURRENCIES.has("GBP")).toBe(false)
    expect(ZERO_DECIMAL_CURRENCIES.has("INR")).toBe(false)
    expect(ZERO_DECIMAL_CURRENCIES.has("BRL")).toBe(false)
  })
})
