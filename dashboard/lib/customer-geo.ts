/**
 * Customer geo detection — used by the public checkout endpoint to infer
 * `country` when the SDK doesn't pass one explicitly.
 *
 * Order of resolution:
 *   1. Explicit `country` query param (highest trust — SDK already
 *      detected via the OS locale / app-stored profile)
 *   2. Cloudflare's `Cf-Ipcountry` header (when running behind Cloudflare)
 *   3. Vercel's `x-vercel-ip-country` header (when running on Vercel)
 *   4. Generic CDN headers (`x-country`, `x-geo-country`)
 *   5. The merchant's own `tenants.country_code` (fallback — most customers
 *      buy from a merchant in their own region; better than null)
 *
 * Returns null if nothing resolves — caller falls back to the merchant's
 * routing default.
 */

import type { NextRequest } from "next/server"

const COUNTRY_HEADERS = [
  "cf-ipcountry",          // Cloudflare
  "x-vercel-ip-country",   // Vercel
  "x-country",
  "x-geo-country",
] as const

const ISO2 = /^[A-Z]{2}$/

export function detectCustomerCountry(
  req: NextRequest,
  fallbackMerchantCountry?: string | null,
): string | null {
  // Explicit query param wins.
  const url = new URL(req.url)
  const explicit = url.searchParams.get("country")
  if (explicit) {
    const normalized = explicit.toUpperCase()
    if (ISO2.test(normalized)) return normalized
  }

  // CDN-injected header chain — try each known header until one resolves.
  for (const header of COUNTRY_HEADERS) {
    const value = req.headers.get(header)
    if (!value) continue
    const normalized = value.toUpperCase()
    if (ISO2.test(normalized) && normalized !== "XX") {
      return normalized
    }
  }

  // Merchant's primary market as last-resort fallback.
  if (fallbackMerchantCountry && ISO2.test(fallbackMerchantCountry.toUpperCase())) {
    return fallbackMerchantCountry.toUpperCase()
  }

  return null
}

/**
 * Currency-from-country heuristic. Not authoritative — many countries have
 * non-obvious currency choices (UAE accepts USD, etc) — but a good default
 * when the SDK didn't pass currency.
 */
const COUNTRY_CURRENCY: Record<string, string> = {
  IN: "INR",
  US: "USD",
  CA: "CAD",
  MX: "MXN",
  GB: "GBP",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  ES: "EUR",
  IT: "EUR",
  AU: "AUD",
  BR: "BRL",
  JP: "JPY",
  KR: "KRW",
  CN: "CNY",
  SG: "SGD",
  AE: "AED",
  ZA: "ZAR",
  NG: "NGN",
  KE: "KES",
  ID: "IDR",
  PH: "PHP",
  TH: "THB",
  VN: "VND",
  TR: "TRY",
  RU: "RUB",
  AR: "ARS",
  CL: "CLP",
  CO: "COP",
  EG: "EGP",
  SA: "SAR",
  PK: "PKR",
  BD: "BDT",
  TW: "TWD",
  PL: "PLN",
}

export function currencyForCountry(country: string | null): string | null {
  if (!country) return null
  return COUNTRY_CURRENCY[country.toUpperCase()] ?? null
}
