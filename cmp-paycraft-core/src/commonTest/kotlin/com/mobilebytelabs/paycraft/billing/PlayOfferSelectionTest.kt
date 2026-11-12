package com.mobilebytelabs.paycraft.billing

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * A win-back offer on the store lane (paycraft-paywall-analytics AC-10): when the buyer claimed an exit-survey
 * offer, the purchase uses THAT offer — the coupon's Play offer id — instead of the best default offer. If Play
 * does not return it (not eligible, not synced, wrong product), the purchase falls back to the default choice
 * rather than failing: the buyer still gets a working checkout.
 */
class PlayOfferSelectionTest {

    private fun phase(micros: Long, period: String = "P1M", cycles: Int = 0) = NativePricingPhase(
        priceAmountMicros = micros,
        formattedPrice = "x",
        currencyCode = "INR",
        billingPeriodIso = period,
        billingCycleCount = cycles,
    )

    private val base = NativeOffer("token_base", "base", listOf(phase(29_900_000)))
    private val trial = NativeOffer("token_trial", "trial7", listOf(phase(0, "P1W", 1), phase(29_900_000)))
    private val winback = NativeOffer("token_wb", "winback-50", listOf(phase(14_950_000, "P1M", 1), phase(29_900_000)))
    private val offers = listOf(base, trial, winback)

    @Test fun the_claimed_winback_offer_is_used_over_the_default() {
        assertEquals("winback-50", chooseOffer(offers, winbackOfferId = "winback-50")?.offerId)
    }

    @Test fun an_offer_play_did_not_return_falls_back_to_the_default_choice() {
        assertEquals(selectBestOffer(offers), chooseOffer(offers, winbackOfferId = "not-synced"))
        assertEquals("trial7", chooseOffer(offers, winbackOfferId = "not-synced")?.offerId)
    }

    @Test fun no_winback_offer_is_the_default_choice() {
        assertEquals(selectBestOffer(offers), chooseOffer(offers, winbackOfferId = null))
        assertEquals(selectBestOffer(offers), chooseOffer(offers, winbackOfferId = ""))
    }
}
