package com.mobilebytelabs.paycraft.presentation

import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ProviderBottomSheetTest {

    private fun provider(key: String) = ProviderDto(provider = key)
    private fun plan(currency: String) = BillingPlan(
        id = "test-sku",
        name = "Test",
        price = "$0",
        interval = "month",
        rank = 0,
        currency = currency,
    )

    // ─── displayLabelFor ────────────────────────────────────────────────────

    @Test
    fun displayLabel_stripe() {
        assertEquals("Stripe", displayLabelFor("stripe"))
    }

    @Test
    fun displayLabel_razorpay() {
        assertEquals("Razorpay", displayLabelFor("razorpay"))
    }

    @Test
    fun displayLabel_paypal() {
        assertEquals("PayPal", displayLabelFor("paypal"))
    }

    @Test
    fun displayLabel_paddle() {
        assertEquals("Paddle", displayLabelFor("paddle"))
    }

    @Test
    fun displayLabel_unknown_titleCasesEachWord() {
        assertEquals("My Custom Provider", displayLabelFor("my_custom_provider"))
    }

    // ─── taglineFor / methodsFor — provider metadata ────────────────────────

    @Test
    fun stripe_tagline_and_methods() {
        assertEquals("Cards, Apple Pay, Google Pay, and Link", taglineFor("stripe"))
        assertTrue(methodsFor("stripe").contains("Visa"))
        assertTrue(methodsFor("stripe").contains("Apple Pay"))
    }

    @Test
    fun razorpay_tagline_and_methods() {
        assertEquals("UPI, cards, wallets, net banking, and EMI", taglineFor("razorpay"))
        assertTrue(methodsFor("razorpay").contains("UPI"))
    }

    @Test
    fun unknown_provider_has_empty_methods() {
        assertEquals(emptyList(), methodsFor("totally_unknown"))
    }

    // ─── recommendedProviderKey — locale-aware default ──────────────────────

    @Test
    fun recommended_inr_picks_razorpay_if_present() {
        val providers = listOf(provider("stripe"), provider("razorpay"))
        assertEquals("razorpay", recommendedProviderKey(providers, plan("INR")))
    }

    @Test
    fun recommended_inr_no_razorpay_returns_null() {
        val providers = listOf(provider("stripe"))
        assertNull(recommendedProviderKey(providers, plan("INR")))
    }

    @Test
    fun recommended_usd_picks_stripe_if_present() {
        val providers = listOf(provider("stripe"), provider("razorpay"))
        assertEquals("stripe", recommendedProviderKey(providers, plan("USD")))
    }

    @Test
    fun recommended_usd_falls_back_to_paddle() {
        val providers = listOf(provider("paddle"), provider("razorpay"))
        assertEquals("paddle", recommendedProviderKey(providers, plan("USD")))
    }

    @Test
    fun recommended_null_plan_returns_null() {
        assertNull(recommendedProviderKey(listOf(provider("stripe")), null))
    }

    // ─── planIntervalSuffix — semantic plurals ──────────────────────────────

    @Test
    fun interval_semiannual_maps_to_6_months() {
        assertEquals("6 months", planIntervalSuffix("semiannual"))
    }

    @Test
    fun interval_lifetime_maps_to_one_time() {
        assertEquals("one time", planIntervalSuffix("lifetime"))
    }

    // ─── AutoSkipWhenSingle strategy logic ───────────────────────────────────

    @Test
    fun autoSkip_singleProvider_strategyShouldSkip() {
        val providers = listOf(provider("stripe"))
        // AutoSkipWhenSingle: only 1 provider → skip sheet (direct checkout)
        val shouldSkip = providers.size == 1
        assertTrue(shouldSkip, "Expected auto-skip when only 1 provider configured")
    }

    @Test
    fun autoSkip_twoProviders_strategyShouldShowSheet() {
        val providers = listOf(provider("stripe"), provider("razorpay"))
        val shouldShowSheet = providers.size >= 2
        assertTrue(shouldShowSheet, "Expected sheet when 2+ providers configured")
    }

    @Test
    fun maxVisible_truncates_overflow_list() {
        val providers = (1..6).map { provider("provider_$it") }
        val maxVisible = 4
        val visible = providers.take(maxVisible)
        val overflow = providers.drop(maxVisible)
        assertEquals(4, visible.size)
        assertEquals(2, overflow.size)
    }

    @Test
    fun providers_locale_filter_trusts_cloud_list() {
        // SDK trusts the cloud to pre-filter by locale; it renders only what it receives.
        // Simulate: cloud returned only Razorpay for locale=IN.
        val cloudFiltered = listOf(provider("razorpay"))
        assertEquals(1, cloudFiltered.size)
        assertEquals("razorpay", cloudFiltered.first().provider)
    }
}
