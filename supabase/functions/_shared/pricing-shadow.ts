/**
 * pricing-shadow.ts — the single site both price-country chains flow through (D4, D11 Stage A).
 *
 * WHAT THE WIRE ACTUALLY CARRIES (this differs from the sub-plan's draft, deliberately)
 * The plan modelled a `storefrontCountry` input as if the SDK sent the storefront separately. It
 * does not. `PayCraft.kt:406-414` resolves `storefront → deviceCountry → US` BEFORE the fetch and
 * then smuggles the answer into `Accept-Language: en-<COUNTRY>`. The server's "locale" extraction
 * has therefore been receiving the SDK's already-storefront-first country all along — for native
 * apps with a wired bridge, pricing was already storefront-driven.
 *
 * So the real defect is not "the server ignores the storefront". It is narrower and worse:
 *
 *   1. PROVENANCE IS LOST ON THE WIRE. `Accept-Language: en-US` is indistinguishable whether it
 *      came from an authoritative Apple storefront, a device SIM, or a browser's language setting.
 *      The server cannot log a meaningful divergence about a signal whose origin it cannot see.
 *   2. WEB AND DESKTOP ARE PRICED OFF BROWSER LANGUAGE. There is no SDK on those platforms, so
 *      Accept-Language is a genuine language preference — while `geoCountry`, computed from the
 *      edge IP header a few lines above, is discarded. A US buyer whose browser prefers fr-FR is
 *      billed in EUR. That is the live revenue bug.
 *   3. AN UNWIRED iOS CONSUMER silently degrades to device locale, and nothing downstream can tell.
 *
 * The resolver therefore takes an explicit provenance input when a modern SDK supplies one
 * (`X-PayCraft-Country-Provenance`), and otherwise INFERS it from the platform header — which
 * matters because the fix must work for app versions already installed, ahead of any SDK bump
 * (D11's whole reason for staging).
 */

export type Provenance =
  | "override"
  | "storefront"
  | "server_geo"
  | "device"
  | "locale"
  | "default";

export type Platform = "android" | "ios" | "web" | "desktop" | "unknown";

export interface PriceInputs {
  /** Explicit developer/tenant override (?country= or x-country). Always wins. */
  overrideCountry: string | null;
  /** Country the SDK resolved and sent via Accept-Language. Null for a real browser. */
  sdkCountry: string | null;
  /** X-PayCraft-Country-Provenance, when a modern SDK sends it. Null for older SDKs. */
  sdkProvenance: Provenance | null;
  /** Edge IP-geo header (x-vercel-ip-country / cf-ipcountry / cloudfront-viewer-country). */
  geoCountry: string | null;
  /** Accept-Language second segment, uppercased. Never null — defaults to US upstream. */
  localeCountry: string;
  platform: Platform;
}

export interface Resolved {
  country: string;
  provenance: Provenance;
}

const NATIVE: ReadonlySet<Platform> = new Set<Platform>(["android", "ios"]);

/**
 * What the SDK's Accept-Language country is WORTH, given what we can observe.
 *
 * An older SDK sends no provenance header, so the strongest honest statement is "a native SDK
 * resolved this" — which is storefront-first by construction (PayCraft.kt) but may have degraded
 * to device country if no bridge was wired. It is reported as `device` rather than `storefront`
 * precisely because the server cannot tell the two apart: claiming `storefront` for a signal that
 * might be a device locale would put a false provenance into the audit log the Stage B decision
 * is made from.
 */
function sdkSignal(i: PriceInputs): Resolved | null {
  if (!i.sdkCountry) return null;
  // The NATIVE gate is checked BEFORE the provenance header, and the order is load-bearing.
  // Previously an explicit `sdkProvenance` short-circuited it, so a web client sending
  // `X-PayCraft-Platform: web` with `X-PayCraft-Country-Provenance: storefront` reached the SDK arm
  // and was priced off its own Accept-Language — the exact thing AC-15 says web must never do.
  // There is no storefront on the web, so no header a client sends can make one exist.
  if (!NATIVE.has(i.platform)) return null;
  if (i.sdkProvenance) return { country: i.sdkCountry, provenance: i.sdkProvenance };
  return { country: i.sdkCountry, provenance: "device" };
}

/**
 * The NEW chain: override → SDK signal (native only) → server geo → locale.
 *
 * Web and desktop skip the SDK arm by construction — there is no store there — and fall to
 * server_geo, never to locale. That single ordering change is the revenue fix.
 */
export function resolveShadow(i: PriceInputs): Resolved {
  if (i.overrideCountry) {
    return { country: i.overrideCountry.toUpperCase(), provenance: "override" };
  }
  const sdk = sdkSignal(i);
  if (sdk) return { country: sdk.country.toUpperCase(), provenance: sdk.provenance };
  if (i.geoCountry) return { country: i.geoCountry.toUpperCase(), provenance: "server_geo" };
  return { country: i.localeCountry.toUpperCase(), provenance: "locale" };
}

/**
 * The OLD chain, preserved byte-for-byte for D11 Stage A: price off Accept-Language ALONE.
 *
 * CORRECTED — this previously honoured `overrideCountry`, on the stated assumption that an override
 * "was already honoured upstream before this phase". That assumption was wrong and was never
 * checked: pre-deploy `config/index.ts` read only `apiKey` from the query string and passed
 * `p_locale: localeCountry` unconditionally. There was no override path anywhere in the priced
 * request. Honouring one here meant any request carrying `?country=` or `x-country` was priced
 * DIFFERENTLY than before the deploy — which is precisely the thing Stage A exists to guarantee
 * cannot happen, and it would have happened silently.
 *
 * The override still exists, in `resolveShadow`, where it can only affect a price after the Stage B
 * cut-over that a human has to authorise.
 */
export function resolveServed(i: PriceInputs): Resolved {
  return { country: i.localeCountry.toUpperCase(), provenance: "locale" };
}

/** True when the two chains disagree on country or on where the country came from. */
export function diverges(served: Resolved, shadow: Resolved): boolean {
  return served.country !== shadow.country || served.provenance !== shadow.provenance;
}
