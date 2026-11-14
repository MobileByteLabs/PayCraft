package com.mobilebytelabs.paycraft.billing

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A paywall must advertise the trial the STORE will give this shopper, not the catalogue's.
 *
 * The defect this locks (reels-downloader 2026-11-14): every Play subscription had an ACTIVE 14-day
 * free-trial offer limited to new subscribers, and the catalogue said `trial_enabled, 14 days`. A user
 * who had subscribed before saw "14-day free trial" on the paywall, then a Play sheet reading
 * "Starting today ₹299.00/month" — Play returns only offers the account is eligible for, but the
 * paywall's trial line was read from the catalogue and never asked.
 */
class AdvertisedTrialDaysTest {

    private fun native(trialDays: Int?) = NativeDisplayPrice("₹299.00", "INR", 299_000_000, freeTrialDays = trialDays)

    @Test
    fun an_account_the_store_gives_no_trial_advertises_no_trial_even_when_the_catalogue_has_one() {
        assertNull(resolveAdvertisedTrialDays(catalogTrialDays = 14, native = native(0)))
    }

    @Test
    fun an_eligible_account_advertises_the_stores_trial() {
        assertEquals(14, resolveAdvertisedTrialDays(catalogTrialDays = 14, native = native(14)))
    }

    @Test
    fun the_store_trial_wins_over_a_different_catalogue_length() {
        // The cappy copy once said 7 days while the store offer was 14 — the store is what the buyer gets.
        assertEquals(14, resolveAdvertisedTrialDays(catalogTrialDays = 7, native = native(14)))
        assertEquals(7, resolveAdvertisedTrialDays(catalogTrialDays = null, native = native(7)))
    }

    @Test
    fun the_catalogue_is_used_only_when_the_store_reported_nothing() {
        // No native price (web lane, cold start) or a store that doesn't resolve offers (freeTrialDays = null).
        assertEquals(14, resolveAdvertisedTrialDays(catalogTrialDays = 14, native = null))
        assertEquals(14, resolveAdvertisedTrialDays(catalogTrialDays = 14, native = native(null)))
    }

    @Test
    fun zero_or_missing_trials_are_never_advertised() {
        assertNull(resolveAdvertisedTrialDays(catalogTrialDays = null, native = null))
        assertNull(resolveAdvertisedTrialDays(catalogTrialDays = 0, native = native(null)))
    }
}
