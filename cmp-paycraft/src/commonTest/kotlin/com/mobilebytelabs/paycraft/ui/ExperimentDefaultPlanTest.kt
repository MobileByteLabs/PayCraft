package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Migration 221: an A/B variant's `default_sku` decides which plan the paywall opens on. */
class ExperimentDefaultPlanTest {

    private fun plan(sku: String, rank: Int, popular: Boolean = false) =
        BillingPlan(id = sku, name = sku, price = "1", interval = "month", rank = rank, isPopular = popular)

    private val plans = listOf(plan("monthly", 0), plan("quarterly", 1, popular = true), plan("yearly", 2))

    @Test
    fun variant_default_sku_is_preselected_over_the_popular_plan() {
        assertEquals("monthly", initialSelectedPlan(plans, 0, "monthly")?.sku)
        assertEquals("monthly", experimentDefaultPlan(plans, "monthly")?.sku)
    }

    @Test
    fun unknown_sku_falls_back_to_the_popular_plan() {
        assertEquals("quarterly", initialSelectedPlan(plans, 0, "gone")?.sku)
        assertNull(experimentDefaultPlan(plans, "gone"))
    }

    @Test
    fun no_experiment_is_unchanged() {
        assertEquals("quarterly", initialSelectedPlan(plans, 0, null)?.sku)
        assertEquals("monthly", initialSelectedPlan(plans.map { it.copy(isPopular = false) }, 0, null)?.sku)
        assertNull(experimentDefaultPlan(plans, null))
    }

    @Test
    fun a_subscriber_still_gets_the_next_plan_up() {
        assertEquals("yearly", initialSelectedPlan(plans, 1, "monthly")?.sku)
    }
}
