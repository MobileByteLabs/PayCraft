package com.mobilebytelabs.paycraft

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Locks the unified cross-platform country resolution + its provenance tags. Pins the precedence
 * `store storefront → server IP-geo → device/SIM → config locale → DEFAULT_COUNTRY` so a web/desktop
 * buyer (no storefront) still resolves to the authoritative server IP-geo instead of the device
 * locale, and every branch reports the correct [CountryProvenance] for downstream trust decisions.
 */
class CountryDetectorTest {

    @Test fun storefrontWinsOverEverything() {
        val d = CountryDetector.resolve(storefront = "IN", serverGeo = "GB", deviceSim = "US", configLocale = "fr")
        assertEquals("IN", d.country)
        assertEquals(CountryProvenance.AUTHORITATIVE_STORE, d.provenance)
    }

    @Test fun serverGeoBeatsDeviceAndLocale() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = "GB", deviceSim = "US", configLocale = "fr")
        assertEquals("GB", d.country)
        assertEquals(CountryProvenance.SERVER_IP_GEO, d.provenance)
    }

    @Test fun deviceUsedWhenNoStorefrontOrGeo() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = null, deviceSim = "US", configLocale = "fr")
        assertEquals("US", d.country)
        assertEquals(CountryProvenance.DEVICE_SIM, d.provenance)
    }

    @Test fun configLocaleFallback() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = null, deviceSim = null, configLocale = "FR")
        assertEquals("FR", d.country)
        assertEquals(CountryProvenance.LOCALE_FALLBACK, d.provenance)
    }

    @Test fun defaultCountryWhenAllAbsent() {
        val d = CountryDetector.resolve(storefront = null, serverGeo = null, deviceSim = null, configLocale = null)
        assertEquals(CurrencyResolver.DEFAULT_COUNTRY, d.country)
        assertEquals(CountryProvenance.LOCALE_FALLBACK, d.provenance)
    }

    @Test fun blankSignalsAreSkipped() {
        // Blank storefront + blank geo must fall through to the device, not resolve to "".
        val d = CountryDetector.resolve(storefront = "  ", serverGeo = "", deviceSim = "IN", configLocale = "us")
        assertEquals("IN", d.country)
        assertEquals(CountryProvenance.DEVICE_SIM, d.provenance)
    }

    // ── StoreKit alpha-3 pass-through ───────────────────────────────────────────────────────
    //
    // Measured on an iOS 26 simulator: `Storefront.current` reports `countryCode = "USA"`, not "US".
    // The SDK forwards it VERBATIM and the server normalizes
    // (`supabase/functions/_shared/country-code.ts`), because an ISO table inside the SDK could only
    // be corrected by a Maven release plus a bump in every consumer — so a storefront Apple adds
    // tomorrow would stay wrong until three apps shipped.
    //
    // These tests pin the pass-through, so a future "helpful" normalization here is caught: it would
    // silently split the mapping across two places that release on different schedules.

    @Test fun storeKitAlpha3StorefrontIsForwardedVerbatim() {
        val d = CountryDetector.resolve(storefront = "IND", serverGeo = null, deviceSim = null, configLocale = null)
        assertEquals("IND", d.country)
        assertEquals(CountryProvenance.AUTHORITATIVE_STORE, d.provenance)
    }

    @Test fun playAlpha2StorefrontIsAlsoForwardedVerbatim() {
        assertEquals("IN", CountryDetector.resolve("IN", null, null, null).country)
        assertEquals("US", CountryDetector.resolve("US", null, null, null).country)
    }

    @Test fun storefrontCasingAndWhitespaceAreNormalized() {
        // Casing/trim IS the SDK's business — it costs no table and keeps the wire value canonical.
        assertEquals("IND", CountryDetector.resolve(" ind ", null, null, null).country)
    }
}
