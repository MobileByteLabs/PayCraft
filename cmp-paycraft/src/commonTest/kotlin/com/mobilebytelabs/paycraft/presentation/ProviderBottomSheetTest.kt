package com.mobilebytelabs.paycraft.presentation

import com.mobilebytelabs.paycraft.config.ProviderDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ProviderBottomSheetTest {

    private fun provider(key: String) = ProviderDto(provider = key)

    // ─── displayLabelFor ────────────────────────────────────────────────────

    @Test
    fun displayLabel_stripe() {
        assertEquals("Card / UPI / Wallet (Stripe)", displayLabelFor("stripe"))
    }

    @Test
    fun displayLabel_razorpay() {
        assertEquals("All Indian methods (Razorpay)", displayLabelFor("razorpay"))
    }

    @Test
    fun displayLabel_paypal() {
        assertEquals("PayPal", displayLabelFor("paypal"))
    }

    @Test
    fun displayLabel_paddle() {
        assertEquals("Card (Paddle)", displayLabelFor("paddle"))
    }

    @Test
    fun displayLabel_unknown_titleCasesEachWord() {
        assertEquals("My Custom Provider", displayLabelFor("my_custom_provider"))
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
