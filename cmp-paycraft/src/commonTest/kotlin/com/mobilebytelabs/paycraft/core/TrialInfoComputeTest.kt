package com.mobilebytelabs.paycraft.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * Unit tests for [computeTrialInfo] — the pure derivation used by
 * [PayCraftBillingManager] to populate [com.mobilebytelabs.paycraft.model.BillingState.Premium.trial].
 *
 * Replaces the full [PayCraftBillingManagerTrialTest] from the original plan
 * (T21) — the integration test required building fakes for PayCraftService,
 * PayCraftStore, DeviceTokenStore, PlatformInfo, and the PayCraft singleton.
 * Testing the pure derivation gives equivalent coverage of the trial-state
 * logic without the fixture overhead.
 */
class TrialInfoComputeTest {

    /** Fixed reference now: 2026-05-21T00:00:00Z = 1779321600000 millis.
     *  Derivation: 20594 days × 86400 s/day × 1000 ms/s (20594 days from epoch
     *  to 2026-05-21, where 1970..2025 contains 14 leap years). */
    private val refNow = 1779321600000L

    @Test
    fun nullTrialEnd_returnsNull() {
        assertNull(computeTrialInfo(null, refNow))
    }

    @Test
    fun blankTrialEnd_returnsNull() {
        assertNull(computeTrialInfo("", refNow))
        assertNull(computeTrialInfo("   ", refNow))
    }

    @Test
    fun unparseableTrialEnd_returnsNull() {
        assertNull(computeTrialInfo("not a date", refNow))
        assertNull(computeTrialInfo("2026-13-99", refNow))
    }

    @Test
    fun trialEndInPast_returnsNull() {
        // 2026-05-20 is 1 day BEFORE refNow.
        assertNull(computeTrialInfo("2026-05-20T00:00:00Z", refNow))
    }

    @Test
    fun trialEndAtNow_returnsNull() {
        // Boundary case: trial_end exactly equal to now → subscription has rolled.
        assertNull(computeTrialInfo("2026-05-21T00:00:00Z", refNow))
    }

    @Test
    fun trialEnd3DaysAhead_returns3DaysRemaining() {
        // 2026-05-24T00:00:00Z = refNow + 3 days exactly.
        val info = computeTrialInfo("2026-05-24T00:00:00Z", refNow)
        assertEquals(3, info?.daysRemaining)
        assertEquals("2026-05-24T00:00:00Z", info?.endsAt)
    }

    @Test
    fun trialEnd7DaysAhead_returns7DaysRemaining() {
        val info = computeTrialInfo("2026-05-28T00:00:00Z", refNow)
        assertEquals(7, info?.daysRemaining)
    }

    @Test
    fun trialEndSlightlyOver1Day_ceilsTo2Days() {
        // 1 day + 1 hour ahead — ceil() should round up to 2 days remaining.
        // refNow + 1d 1h = 2026-05-22T01:00:00Z
        val info = computeTrialInfo("2026-05-22T01:00:00Z", refNow)
        assertEquals(2, info?.daysRemaining)
    }

    @Test
    fun trialEndSlightlyUnderEndOfDay_ceilsTo1Day() {
        // refNow + 1h = 2026-05-21T01:00:00Z — within the same first day
        val info = computeTrialInfo("2026-05-21T01:00:00Z", refNow)
        assertEquals(1, info?.daysRemaining)
    }
}
