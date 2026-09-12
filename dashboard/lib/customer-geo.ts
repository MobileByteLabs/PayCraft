/**
 * Customer geo detection — used by the public checkout endpoint to infer
 * `country` when the SDK doesn't pass one explicitly.
 *
 * Order of resolution — deliberately the same shape as the SDK's CountryDetector and the
 * `/config` edge function's `resolveShadow`, so one buyer cannot be priced two ways depending on
 * whether they checked out through the app or the web (AC-19):
 *
 *   1. Explicit `country` query param                          → provenance "override"
 *   2. Edge IP-geo headers, in the same order the edge function reads them
 *      (`cf-ipcountry` → `x-vercel-ip-country` → `cloudfront-viewer-country`,
 *      then the generic `x-country` / `x-geo-country`)          → provenance "server_geo"
 *   3. The merchant's own `tenants.country_code`                → provenance "default"
 *
 * There is no storefront arm: this is the WEB checkout, where no store storefront exists. That is
 * also why locale is absent entirely — a browser's Accept-Language is a language preference, not a
 * billing region, and treating it as one is the bug this chain exists to avoid.
 *
 * `x-vercel-ip-country` and `cloudfront-viewer-country` were previously DOCUMENTED here but never
 * present in the header array — the doc described a chain the code did not implement, so a Vercel
 * or CloudFront deployment silently fell through to the merchant default.
 *
 * Returns null if nothing resolves — caller falls back to the merchant's routing default.
 */

import type { NextRequest } from "next/server"

// Same set, same precedence, as supabase/functions/config/index.ts. Adding the two that were
// documented-but-missing is the actual fix; keeping the generic pair preserves existing behaviour
// for any CDN already relying on them.
const COUNTRY_HEADERS = [
  "cf-ipcountry",               // Cloudflare (Workers) — the runtime we deploy on
  "x-vercel-ip-country",        // Vercel — was documented, never read
  "cloudfront-viewer-country",  // CloudFront — read by the edge function, absent here
  "x-country",
  "x-geo-country",
] as const

/** Where a resolved country came from. Mirrors the edge function's Provenance union. */
export type GeoProvenance = "override" | "server_geo" | "default" | "none"

export interface DetectedCountry {
  country: string | null
  provenance: GeoProvenance
}

const ISO2 = /^[A-Z]{2}$/

/**
 * Provenance-carrying resolution. `detectCustomerCountry` wraps this and returns only the country,
 * so existing callers are unaffected; new callers that need to know how much to trust the answer
 * (or to compare chains, per AC-19) use this directly.
 */
export function detectCustomerCountryWithProvenance(
  req: NextRequest,
  fallbackMerchantCountry?: string | null,
): DetectedCountry {
  const c = detectCustomerCountryInner(req, fallbackMerchantCountry)
  return c
}

export function detectCustomerCountry(
  req: NextRequest,
  fallbackMerchantCountry?: string | null,
): string | null {
  return detectCustomerCountryInner(req, fallbackMerchantCountry).country
}

function detectCustomerCountryInner(
  req: NextRequest,
  fallbackMerchantCountry?: string | null,
): DetectedCountry {
  // Explicit query param wins.
  const url = new URL(req.url)
  const explicit = url.searchParams.get("country")
  if (explicit) {
    const normalized = explicit.toUpperCase()
    if (ISO2.test(normalized)) return { country: normalized, provenance: "override" }
  }

  // CDN-injected header chain — try each known header until one resolves.
  for (const header of COUNTRY_HEADERS) {
    const value = req.headers.get(header)
    if (!value) continue
    const normalized = value.toUpperCase()
    if (ISO2.test(normalized) && normalized !== "XX") {
      return { country: normalized, provenance: "server_geo" }
    }
  }

  // Merchant's primary market as last-resort fallback.
  if (fallbackMerchantCountry && ISO2.test(fallbackMerchantCountry.toUpperCase())) {
    return { country: fallbackMerchantCountry.toUpperCase(), provenance: "default" }
  }

  return { country: null, provenance: "none" }
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
