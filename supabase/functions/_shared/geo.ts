// supabase/functions/_shared/geo.ts
//
// The buyer's country as the hosting edge reports it — ONE implementation for every function that needs it
// (`config` prices with it; `events` and `winback` stamp it on what they store, so the dashboard's
// per-country funnel never trusts a client-sent country).
//
// Header order and validation are IDENTICAL to dashboard/lib/customer-geo.ts (they once disagreed on five real
// inputs — a buyer priced one way in the app and another through web checkout). Cloudflare first because that
// is the runtime PayCraft deploys on. "XX" is the CDN's unknown-country placeholder, not a country, and a
// three-letter value is not ISO-3166 alpha-2 — both are rejected.

import { toAlpha2 } from "./country-code.ts"

export const GEO_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
  "x-country",
  "x-geo-country",
] as const

const ISO2 = /^[A-Z]{2}$/

/** The edge's IP-geo country, or null when no edge header is present (local dev, unknown host). */
export function geoCountry(req: Request): string | null {
  for (const h of GEO_HEADERS) {
    const raw = req.headers.get(h)?.trim()?.toUpperCase()
    if (raw && ISO2.test(raw) && raw !== "XX") return raw
  }
  return null
}

/**
 * The country to RECORD for a request: the edge's IP-geo first, else the region of the first Accept-Language
 * tag (the SDKs send their resolved country there), else null. Pricing in `config` keeps its own precedence
 * chain (override / storefront / shadow) and only shares [geoCountry].
 */
export function recordedCountry(req: Request): string | null {
  const geo = geoCountry(req)
  if (geo) return geo
  const tag = (req.headers.get("accept-language") ?? "").split(",")[0]?.trim() ?? ""
  const region = toAlpha2(tag.split("-")[1])
  return region && ISO2.test(region) && region !== "XX" ? region : null
}
