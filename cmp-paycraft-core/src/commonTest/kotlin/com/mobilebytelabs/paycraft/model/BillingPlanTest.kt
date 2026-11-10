package com.mobilebytelabs.paycraft.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/**
 * AR-008: `BillingPlan.trialDays` is `Int?`.
 * - `null` = no trial (valid, default)
 * - `>= 1` = trial in days (valid)
 * - `0` or negative = `IllegalArgumentException` at construction
 */
class BillingPlanTest {

    private fun plan(trialDays: Int?): BillingPlan = BillingPlan(
        id = "test_monthly",
        name = "Test Monthly",
        price = "$4.99",
        interval = "month",
        rank = 1,
        trialDays = trialDays,
    )

    @Test
    fun trialDays_null_constructs_andStaysNull() {
        val p = plan(trialDays = null)
        assertNull(p.trialDays)
    }

    @Test
    fun trialDays_default_isNull() {
        // No trialDays argument — exercises the default-parameter path.
        val p = BillingPlan(
            id = "test_yearly",
            name = "Test Yearly",
            price = "$49.99",
            interval = "year",
            rank = 3,
        )
        assertNull(p.trialDays)
    }

    @Test
    fun trialDays_1_constructs() {
        assertEquals(1, plan(trialDays = 1).trialDays)
    }

    @Test
    fun trialDays_7_constructs() {
        assertEquals(7, plan(trialDays = 7).trialDays)
    }

    @Test
    fun trialDays_30_constructs() {
        assertEquals(30, plan(trialDays = 30).trialDays)
    }

    @Test
    fun trialDays_0_throws() {
        assertFailsWith<IllegalArgumentException> { plan(trialDays = 0) }
    }

    @Test
    fun trialDays_negativeOne_throws() {
        assertFailsWith<IllegalArgumentException> { plan(trialDays = -1) }
    }

    @Test
    fun trialDays_largeNegative_throws() {
        assertFailsWith<IllegalArgumentException> { plan(trialDays = -365) }
    }
}
