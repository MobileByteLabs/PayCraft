package com.mobilebytelabs.paycraft.ui.survey

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.time.Instant

/** The offer card's "₹299 → ₹149.50" and "Ends in 47:59" (paycraft-paywall-analytics T13 Designed UX). */
class WinbackOfferFormatTest {

    @Test fun discounts_keep_the_price_format() {
        assertEquals(
            "₹149.50",
            discountedPrice("₹299", 50),
            "a whole price halving to a fraction shows the paise charged",
        )
        assertEquals("₹100", discountedPrice("₹200", 50))
        assertEquals("$4.99", discountedPrice("$9.98", 50), "the original's decimals are kept")
        assertEquals("₹1,124.25", discountedPrice("₹1,499", 25), "grouping is kept")
        assertEquals("US$ 7.20 / month", discountedPrice("US$ 9.00 / month", 20), "text around the number is kept")
        assertNull(discountedPrice("Free", 50))
    }

    @Test fun time_left_reads_hours_and_minutes_then_days() {
        val end = "2026-11-12T10:00:00Z"
        val at = Instant.parse(end).toEpochMilliseconds()
        assertEquals("47:59", offerTimeLeft(end, at - (47 * 60 + 59) * 60_000L - 30_000))
        assertEquals("0:05", offerTimeLeft(end, at - 5 * 60_000L))
        assertEquals("5d", offerTimeLeft(end, at - 120 * 3_600_000L))
        assertNull(offerTimeLeft(end, at), "expired → no countdown")
        assertNull(offerTimeLeft("not a date", 0))
    }
}
