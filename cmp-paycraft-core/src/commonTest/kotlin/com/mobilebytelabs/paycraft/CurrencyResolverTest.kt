package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Locks the single currency/country deciding point. These pin the resolution order (so a
 * device in India never silently gets US/USD) and the shared provider fallback (so two
 * providers can never route different currencies for the same plan).
 */
class CurrencyResolverTest {

    private fun plan(sku: String, currency: String, rank: Int) =
        BillingPlan(id = sku, name = sku, price = "x", interval = "month", rank = rank, currency = currency)

    // ── resolveCountry: override → store storefront → device → configLocale → "US" ────────

    @Test fun country_overrideWins() {
        assertEquals(
            "GB",
            CurrencyResolver.resolveCountry(
                override = "GB",
                storeStorefront = "IN",
                deviceCountry = "IN",
                configLocale = "US",
            ),
        )
    }

    @Test fun country_deviceWhenNoOverride() {
        assertEquals(
            "IN",
            CurrencyResolver.resolveCountry(
                override = null,
                storeStorefront = null,
                deviceCountry = "IN",
                configLocale = "US",
            ),
        )
    }

    @Test fun country_configLocaleWhenNoOverrideOrDevice() {
        assertEquals(
            "DE",
            CurrencyResolver.resolveCountry(
                override = null,
                storeStorefront = null,
                deviceCountry = null,
                configLocale = "DE",
            ),
        )
    }

    @Test fun country_defaultsToUS() {
        assertEquals(
            "US",
            CurrencyResolver.resolveCountry(
                override = "  ",
                storeStorefront = null,
                deviceCountry = null,
                configLocale = null,
            ),
        )
    }

    // ── store storefront (the true billing region) wins over the device UI locale ─────────

    @Test fun country_storefrontWinsOverDevice() {
        // The paywall-currency bug: India buyer (IN storefront) on an en-GB phone (GB device
        // locale) must resolve to IN so pricing is ₹/INR, never GB/GBP.
        assertEquals(
            "IN",
            CurrencyResolver.resolveCountry(
                override = null,
                storeStorefront = "IN",
                deviceCountry = "GB",
                configLocale = "US",
            ),
        )
    }

    @Test fun country_overrideWinsOverStorefront() {
        assertEquals(
            "US",
            CurrencyResolver.resolveCountry(
                override = "US",
                storeStorefront = "IN",
                deviceCountry = "GB",
                configLocale = "DE",
            ),
        )
    }

    @Test fun country_storefrontNullFallsThroughToDevice() {
        assertEquals(
            "GB",
            CurrencyResolver.resolveCountry(
                override = null,
                storeStorefront = "   ",
                deviceCountry = "GB",
                configLocale = "US",
            ),
        )
    }

    @Test fun country_allNullDefaultsToUS() {
        assertEquals(
            "US",
            CurrencyResolver.resolveCountry(
                override = null,
                storeStorefront = null,
                deviceCountry = null,
                configLocale = null,
            ),
        )
    }

    // ── resolveCurrency: one currency for the whole paywall ──────────────────────────────

    @Test fun currency_fromFirstPlan_uppercased() {
        val plans = listOf(plan("pro-monthly", "inr", 0), plan("pro-annual", "inr", 1))
        assertEquals("INR", CurrencyResolver.resolveCurrency(plans))
    }

    @Test fun currency_fallbackWhenNoPlans() {
        assertEquals("USD", CurrencyResolver.resolveCurrency(emptyList()))
    }

    // ── checkoutCurrency: shared deterministic fallback for every provider ────────────────

    @Test fun checkout_activeWhenAvailable() {
        assertEquals("INR", CurrencyResolver.checkoutCurrency("INR", setOf("USD", "INR", "EUR")))
    }

    @Test fun checkout_fallsBackToUsd() {
        assertEquals("USD", CurrencyResolver.checkoutCurrency("INR", setOf("USD", "EUR")))
    }

    @Test fun checkout_fallsBackToFirstWhenNoUsd() {
        assertEquals("EUR", CurrencyResolver.checkoutCurrency("INR", setOf("EUR")))
    }

    @Test fun checkout_returnsActiveWhenNoneAvailable() {
        // Empty link map → return active so the caller surfaces a clear missing-link error.
        assertEquals("INR", CurrencyResolver.checkoutCurrency("INR", emptySet()))
    }
}
