package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.billing.CheckoutLane
import com.mobilebytelabs.paycraft.config.ProviderDto
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A checkout event names the provider whenever the paywall knows it (paycraft-ga4-analytics-audit AC-1). Every live
 * `paycraft_checkout_start` on prod (97 of 97, 2026-11-25) arrived without one, because the store / single-provider
 * path passed `null` — so the dashboard could not split checkouts by provider at all. The provider is read from the
 * lane the purchase actually takes ([com.mobilebytelabs.paycraft.billing.resolveCheckoutLane]), never re-derived.
 */
class CheckoutProviderEventTest {

    private val razorpay = ProviderDto(provider = "razorpay")
    private val stripe = ProviderDto(provider = "stripe")

    @Test fun the_play_lane_is_google_play() {
        assertEquals(
            "google_play",
            checkoutProviderFor(CheckoutLane.NativePlay("pro_monthly"), listOf(razorpay, stripe)),
        )
    }

    @Test fun the_storekit_lane_is_the_app_store() {
        assertEquals("app_store", checkoutProviderFor(CheckoutLane.NativeStoreKit("com.x.pro"), listOf(stripe)))
    }

    @Test fun a_web_lane_with_one_configured_provider_is_that_provider() {
        assertEquals("razorpay", checkoutProviderFor(CheckoutLane.Web, listOf(razorpay)))
    }

    @Test fun a_web_lane_with_several_providers_is_not_guessed() {
        assertNull(checkoutProviderFor(CheckoutLane.Web, listOf(razorpay, stripe)))
        assertNull(checkoutProviderFor(CheckoutLane.Web, emptyList()))
    }
}
