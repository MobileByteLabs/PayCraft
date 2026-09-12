// AC-12 / AC-15 / AC-17 — the two price-country chains, exercised directly.
//
// These run the SHIPPED resolver, not a copy of its rules. The Stage A invariant is the one worth
// stating plainly: for every input, `resolveServed` must return exactly what the pre-deploy code
// would have returned (locale, or the pre-existing override) — otherwise "shadow mode" has already
// moved a price and D11's staging is theatre.
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  diverges,
  resolveServed,
  resolveShadow,
  type PriceInputs,
} from "../../../../../supabase/functions/_shared/pricing-shadow.ts";

const base: PriceInputs = {
  overrideCountry: null,
  sdkCountry: null,
  sdkProvenance: null,
  geoCountry: null,
  localeCountry: "US",
  platform: "unknown",
};

Deno.test("AC-15 web: geo beats browser language — the live revenue bug", () => {
  // A US buyer whose browser prefers French. Today this is billed in EUR.
  const i: PriceInputs = { ...base, platform: "web", localeCountry: "FR", geoCountry: "US" };
  assertEquals(resolveServed(i), { country: "FR", provenance: "locale" });   // what ships today
  assertEquals(resolveShadow(i), { country: "US", provenance: "server_geo" }); // what should ship
  assertEquals(diverges(resolveServed(i), resolveShadow(i)), true);
});

Deno.test("AC-15 web NEVER falls to locale while geo is present", () => {
  for (const loc of ["FR", "DE", "JP", "IN"]) {
    const i: PriceInputs = { ...base, platform: "web", localeCountry: loc, geoCountry: "US" };
    assertEquals(resolveShadow(i).provenance, "server_geo");
  }
});

Deno.test("AC-15 desktop behaves as web — no storefront exists there either", () => {
  const i: PriceInputs = { ...base, platform: "desktop", localeCountry: "FR", geoCountry: "US" };
  assertEquals(resolveShadow(i), { country: "US", provenance: "server_geo" });
});

Deno.test("AC-12 native SDK signal outranks server geo", () => {
  // The SDK already resolved storefront-first and sent it via Accept-Language.
  const i: PriceInputs = {
    ...base, platform: "ios", sdkCountry: "IN", localeCountry: "IN", geoCountry: "US",
  };
  assertEquals(resolveShadow(i).country, "IN");
});

Deno.test("AC-12 an explicit SDK provenance is trusted over inference", () => {
  const i: PriceInputs = {
    ...base, platform: "ios", sdkCountry: "IN", sdkProvenance: "storefront",
    localeCountry: "IN", geoCountry: "US",
  };
  assertEquals(resolveShadow(i), { country: "IN", provenance: "storefront" });
});

Deno.test("an older SDK is reported as 'device', never as 'storefront'", () => {
  // The server cannot tell a storefront-derived country from a device-locale one when no
  // provenance header is sent. Claiming 'storefront' would put a false fact into the very log the
  // Stage B decision is made from.
  const i: PriceInputs = { ...base, platform: "android", sdkCountry: "GB", localeCountry: "GB" };
  assertEquals(resolveShadow(i).provenance, "device");
});

Deno.test("an override moves the SHADOW chain only — Stage A must not honour it", () => {
  // Regression for a real Stage A violation. `resolveServed` used to honour the override on the
  // stated assumption that one "was already honoured upstream". It was not: pre-deploy
  // config/index.ts read only `apiKey` from the query string and priced unconditionally off
  // Accept-Language. Honouring it in the served chain meant any request carrying `?country=` or
  // `x-country` was priced differently after the deploy than before — silently, and precisely
  // what Stage A exists to make impossible.
  const i: PriceInputs = {
    ...base, platform: "web", overrideCountry: "jp", localeCountry: "FR", geoCountry: "US",
  };
  assertEquals(resolveServed(i), { country: "FR", provenance: "locale" });
  assertEquals(resolveShadow(i), { country: "JP", provenance: "override" });
  assertEquals(diverges(resolveServed(i), resolveShadow(i)), true);
});

Deno.test("AC-15 a spoofed provenance header cannot buy a web client into the SDK arm", () => {
  // The native gate used to sit AFTER the provenance check, so a caller sending
  // `X-PayCraft-Platform: web` with `X-PayCraft-Country-Provenance: storefront` was priced off its
  // own Accept-Language while being recorded as an authoritative storefront. There is no storefront
  // on the web, so no header can make one exist.
  for (const claimed of ["storefront", "device", "override", "default"] as const) {
    const i: PriceInputs = {
      ...base, platform: "web", sdkCountry: "IN", sdkProvenance: claimed,
      geoCountry: "US", localeCountry: "IN",
    };
    assertEquals(resolveShadow(i), { country: "US", provenance: "server_geo" });
  }
  // Desktop is the same story.
  const d: PriceInputs = {
    ...base, platform: "desktop", sdkCountry: "IN", sdkProvenance: "storefront",
    geoCountry: "US", localeCountry: "IN",
  };
  assertEquals(resolveShadow(d).provenance, "server_geo");
});

Deno.test("STAGE A INVARIANT — served is ALWAYS the Accept-Language country, for every input", () => {
  // Deliberately swept over the override too. The previous version of this test asserted
  // "locale-OR-override", which is the Stage A violation restated as an expectation — it passed
  // while the served chain was moving prices for any request carrying an override.
  const countries = ["US", "FR", "IN", "JP"];
  const platforms: PriceInputs["platform"][] = ["android", "ios", "web", "desktop", "unknown"];
  const provenances: (PriceInputs["sdkProvenance"])[] = [null, "storefront", "device", "override"];
  for (const platform of platforms) {
    for (const localeCountry of countries) {
      for (const geoCountry of [null, "US", "DE"]) {
        for (const sdkCountry of [null, "IN"]) {
          for (const overrideCountry of [null, "JP", "br"]) {
            for (const sdkProvenance of provenances) {
              const i: PriceInputs = {
                ...base, platform, localeCountry, geoCountry, sdkCountry,
                overrideCountry, sdkProvenance,
              };
              assertEquals(
                resolveServed(i),
                { country: localeCountry, provenance: "locale" },
                `served must equal pre-deploy for ${JSON.stringify(i)}`,
              );
            }
          }
        }
      }
    }
  }
});

Deno.test("no geo and no SDK signal — both chains agree on locale, so nothing is logged", () => {
  const i: PriceInputs = { ...base, platform: "web", localeCountry: "FR" };
  assertEquals(resolveShadow(i), { country: "FR", provenance: "locale" });
  assertEquals(diverges(resolveServed(i), resolveShadow(i)), false);
});

Deno.test("country casing is normalised in both chains", () => {
  const i: PriceInputs = { ...base, platform: "web", localeCountry: "fr", geoCountry: "us" };
  assertEquals(resolveServed(i).country, "FR");
  assertEquals(resolveShadow(i).country, "US");
});
