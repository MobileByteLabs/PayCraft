package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.model.BillingPlan

/**
 * The single resolved billing region for a PayCraft session — one country + one currency
 * shared by the displayed price AND every payment provider's checkout link.
 *
 * @property country  ISO 3166-1 alpha-2 (e.g. "US", "IN").
 * @property currency ISO 4217 (e.g. "USD", "INR").
 */
data class ResolvedRegion(val country: String, val currency: String)

/**
 * THE single deciding point for currency/country across the SDK.
 *
 * Why this exists: previously the country defaulted to a hardcoded "US" (device region was
 * never read), the currency lived implicitly on each [BillingPlan], and every provider's
 * checkout-URL lookup did its OWN `plan.currency → USD → first` fallback — so the paywall
 * could display ₹/INR while one provider routed checkout in USD, and two providers could
 * disagree. Centralizing the decision here guarantees price + all providers stay consistent.
 *
 * Resolution model:
 *  1. [resolveCountry] picks the country ONCE (override → device → cloud locale → "US").
 *  2. The country is sent to `/config`, which returns per-locale prices; [resolveCurrency]
 *     reads back the single currency the cloud resolved for that locale.
 *  3. [checkoutCurrency] picks each provider's checkout-link currency from that ONE active
 *     currency with a deterministic shared fallback — identical for every provider.
 */
object CurrencyResolver {
    const val DEFAULT_COUNTRY = "US"
    const val FALLBACK_CURRENCY = "USD"

    /**
     * Decide the billing country once, override-wins:
     * [override] (InitOptions.localeOverride) → [deviceCountry] (PlatformInfo.country) →
     * [configLocale] (SuiteConfig.locale) → [DEFAULT_COUNTRY].
     */
    fun resolveCountry(override: String?, deviceCountry: String?, configLocale: String?): String =
        override?.trim()?.takeIf { it.isNotBlank() }
            ?: deviceCountry?.trim()?.takeIf { it.isNotBlank() }
            ?: configLocale?.trim()?.takeIf { it.isNotBlank() }
            ?: DEFAULT_COUNTRY

    /**
     * The one currency the whole paywall uses — the currency the cloud resolved for the active
     * locale. Uniform across products for a given locale, so the first plan is authoritative.
     */
    fun resolveCurrency(plans: List<BillingPlan>): String =
        plans.firstOrNull { it.currency.isNotBlank() }?.currency?.uppercase()
            ?: FALLBACK_CURRENCY

    /**
     * Pick the checkout-link currency for ANY provider from the single [active] currency, with
     * a deterministic shared fallback so providers never diverge: active → [FALLBACK_CURRENCY]
     * → first available. Returns [active] unchanged when [available] is empty (caller surfaces
     * the missing-link error with full context).
     */
    fun checkoutCurrency(active: String, available: Set<String>): String = when {
        available.isEmpty() -> active
        active in available -> active
        FALLBACK_CURRENCY in available -> FALLBACK_CURRENCY
        else -> available.first()
    }
}
