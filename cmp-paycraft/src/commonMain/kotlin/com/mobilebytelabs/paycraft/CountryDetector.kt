package com.mobilebytelabs.paycraft


/**
 * Where a resolved billing country came from, most-authoritative first. Downstream pricing/tax
 * logic can decide how much to trust the value (e.g. prefer the store storefront over an IP guess,
 * or prompt the user to confirm when only a weak signal is available).
 *
 * - [AUTHORITATIVE_STORE] — the Play/Apple payment-account storefront (Play `getBillingConfig`
 *   countryCode / StoreKit `Storefront.current` countryCode). The true billing region; never cached.
 * - [SERVER_IP_GEO] — the country the PayCraft cloud resolved from the request's edge IP-country
 *   header (`geo_country` on the `/config` response). One consistent signal across every platform.
 * - [DEVICE_SIM] — the device's own SIM/network/locale country ([PlatformInfo.country]).
 * - [LOCALE_FALLBACK] — the cloud config locale, or [CurrencyResolver.DEFAULT_COUNTRY] as the
 *   absolute last resort. Weakest signal.
 */
enum class CountryProvenance { AUTHORITATIVE_STORE, SERVER_IP_GEO, DEVICE_SIM, LOCALE_FALLBACK }

/** A resolved billing country plus the provenance of the signal it came from. */
data class DetectedCountry(val country: String, val provenance: CountryProvenance)

/**
 * Folds a unified, cross-platform buyer-country signal from four inputs in strict priority order,
 * tagging each result with its [CountryProvenance]:
 *
 * `store storefront → server IP-geo → device/SIM → config locale → [CurrencyResolver.DEFAULT_COUNTRY]`
 *
 * The store storefront is authoritative for billing (it's where the payment account lives), so it
 * wins. The server IP-geo — attached by `/config` from the edge IP-country header — is one uniform
 * signal that works on every platform (web/desktop included, where no store storefront exists), so
 * it beats the device locale. Device/SIM and config-locale are weak fallbacks.
 *
 * [CurrencyResolver.resolveCountry] wraps this with the developer `override` (highest priority) and
 * consumes only `.country`; the [provenance] is exposed for callers that want to gate trust.
 */
object CountryDetector {
    fun resolve(storefront: String?, serverGeo: String?, deviceSim: String?, configLocale: String?): DetectedCountry {
        // Passed through VERBATIM, including StoreKit's alpha-3 ("IND"). Normalizing here would put
        // an ISO table inside the SDK, where correcting it costs a Maven release plus a bump in every
        // consumer — so a storefront Apple adds tomorrow would be wrong until three apps ship. The
        // server normalizes instead (), which is also
        // where the values are CONSUMED: tenant_pricing.locale and supported_locales.
        storefront?.trim()?.uppercase()?.takeIf { it.isNotBlank() }
            ?.let { return DetectedCountry(it, CountryProvenance.AUTHORITATIVE_STORE) }
        serverGeo?.trim()?.takeIf { it.isNotBlank() }
            ?.let { return DetectedCountry(it, CountryProvenance.SERVER_IP_GEO) }
        deviceSim?.trim()?.takeIf { it.isNotBlank() }
            ?.let { return DetectedCountry(it, CountryProvenance.DEVICE_SIM) }
        val fallback = configLocale?.trim()?.takeIf { it.isNotBlank() } ?: CurrencyResolver.DEFAULT_COUNTRY
        return DetectedCountry(fallback, CountryProvenance.LOCALE_FALLBACK)
    }
}
