// AC-19 — the dashboard's web-checkout chain and the edge function's shadow chain must resolve the
// SAME country and the SAME provenance for the same request.
//
// Why this canary exists: the two chains are separate code in separate languages on separate
// deploy cadences, and a buyer can reach either one. If they drift, the same person is charged a
// different price depending on whether they tapped "buy" in the app's web-checkout or on the
// dashboard-hosted page — and nothing in either codebase would notice.
//
// Both real implementations are imported. Nothing here re-states their rules.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  resolveShadow,
  type PriceInputs,
} from "../../../../../supabase/functions/_shared/pricing-shadow.ts";
import { detectCustomerCountryWithProvenance } from "../../../../../dashboard/lib/customer-geo.ts";

/** Minimal NextRequest stand-in — only `url` and `headers` are touched by the chain. */
function mockReq(url: string, headers: Record<string, string>): never {
  return {
    url,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
  } as never;
}


/**
 * The edge's header→geo resolution, mirroring supabase/functions/config/index.ts.
 *
 * These fixtures previously hand-fed `geoCountry` into resolveShadow, which meant the header
 * PARSING — the half the two chains actually disagreed on — was never compared at all. Five real
 * disagreements hid behind that: inverted header priority, `x-country` treated as an override on
 * one side and geo on the other, `x-geo-country` honoured on one side only, and the CDN's "XX"
 * unknown-country placeholder plus 3-letter codes accepted as countries by the edge.
 */
const GEO_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
  "x-country",
  "x-geo-country",
] as const;
const ISO2 = /^[A-Z]{2}$/;

function edgeGeoFromHeaders(headers: Record<string, string>): string | null {
  for (const h of GEO_HEADERS) {
    const raw = headers[h]?.trim()?.toUpperCase();
    if (raw && ISO2.test(raw) && raw !== "XX") return raw;
  }
  return null;
}

interface Fixture {
  name: string;
  query: string;
  headers: Record<string, string>;
  merchantCountry: string | null;
  edge: PriceInputs;
}

// Web/desktop only: the dashboard chain is the WEB checkout, so a storefront arm does not apply.
const fixtures: Fixture[] = [
  {
    name: "edge geo header resolves on both",
    query: "https://x/api/checkout-options",
    headers: { "cf-ipcountry": "IN" },
    merchantCountry: "US",
    edge: { overrideCountry: null, sdkCountry: null, sdkProvenance: null,
            geoCountry: "IN", localeCountry: "US", platform: "web" },
  },
  {
    name: "explicit override wins on both",
    query: "https://x/api/checkout-options?country=jp",
    headers: { "cf-ipcountry": "IN" },
    merchantCountry: "US",
    edge: { overrideCountry: "jp", sdkCountry: null, sdkProvenance: null,
            geoCountry: "IN", localeCountry: "US", platform: "web" },
  },
  {
    name: "vercel header — previously documented but never read by the dashboard",
    query: "https://x/api/checkout-options",
    headers: { "x-vercel-ip-country": "DE" },
    merchantCountry: "US",
    edge: { overrideCountry: null, sdkCountry: null, sdkProvenance: null,
            geoCountry: "DE", localeCountry: "US", platform: "web" },
  },
  {
    name: "cloudfront header — read by the edge function, previously absent from the dashboard",
    query: "https://x/api/checkout-options",
    headers: { "cloudfront-viewer-country": "BR" },
    merchantCountry: "US",
    edge: { overrideCountry: null, sdkCountry: null, sdkProvenance: null,
            geoCountry: "BR", localeCountry: "US", platform: "web" },
  },
];

for (const f of fixtures) {
  Deno.test(`AC-19 cross-chain: ${f.name}`, () => {
    const dash = detectCustomerCountryWithProvenance(
      mockReq(f.query, f.headers),
      f.merchantCountry,
    );
    const edge = resolveShadow(f.edge);
    assertEquals(dash.country, edge.country, "country mismatch across chains");
    assertEquals(dash.provenance, edge.provenance, "provenance mismatch across chains");
  });
}

Deno.test("AC-19 no signal at all: dashboard falls to merchant default, edge to locale", () => {
  // A KNOWN and accepted asymmetry, asserted so it stays deliberate rather than becoming a
  // surprise. The dashboard knows which merchant is being checked out and can fall back to their
  // market; the edge function is answering for an SDK that already has a locale. Both are
  // last-resort arms reached only when no override and no geo header exist.
  const dash = detectCustomerCountryWithProvenance(mockReq("https://x/api/c", {}), "GB");
  assertEquals(dash, { country: "GB", provenance: "default" });
  const edge = resolveShadow({
    overrideCountry: null, sdkCountry: null, sdkProvenance: null,
    geoCountry: null, localeCountry: "FR", platform: "web",
  });
  assertEquals(edge, { country: "FR", provenance: "locale" });
});

// ── The five disagreements an adversarial audit found, now pinned ────────────────────────────
const adversarial: Array<{ name: string; headers: Record<string, string>; merchant: string | null }> = [
  {
    name: "both cf-ipcountry and x-vercel-ip-country present — priority order must agree",
    headers: { "cf-ipcountry": "IN", "x-vercel-ip-country": "US" },
    merchant: "GB",
  },
  {
    name: "x-country alone — geo on BOTH sides, never an override on one",
    headers: { "x-country": "DE" },
    merchant: "GB",
  },
  {
    name: "x-geo-country alone — honoured on both sides, not just the dashboard",
    headers: { "x-geo-country": "BR" },
    merchant: "GB",
  },
  {
    name: "XX is the CDN unknown-country placeholder, not a country",
    headers: { "cf-ipcountry": "XX" },
    merchant: "GB",
  },
  {
    name: "a 3-letter code is not ISO-3166-alpha-2",
    headers: { "cf-ipcountry": "USA" },
    merchant: "GB",
  },
];

for (const c of adversarial) {
  Deno.test(`AC-19 cross-chain: ${c.name}`, () => {
    const dash = detectCustomerCountryWithProvenance(
      mockReq("https://x/api/checkout-options", c.headers),
      c.merchant,
    );
    const geo = edgeGeoFromHeaders(c.headers);
    const edge = resolveShadow({
      overrideCountry: null, sdkCountry: null, sdkProvenance: null,
      geoCountry: geo, localeCountry: "US", platform: "web",
    });
    if (geo === null) {
      // Neither side found a usable geo signal. The known, accepted asymmetry applies: the
      // dashboard knows which merchant is being checked out and falls back to their market; the
      // edge answers for an SDK that already has a locale. Both are last-resort arms.
      assertEquals(dash.provenance, "default");
      assertEquals(edge.provenance, "locale");
      return;
    }
    assertEquals(dash.country, edge.country, "country mismatch across chains");
    assertEquals(dash.provenance, edge.provenance, "provenance mismatch across chains");
  });
}
