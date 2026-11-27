package com.mobilebytelabs.paycraft.ui.survey

import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.ui.planForOffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A win-back offer names its plan by SKU. Live plans have an id (the product uuid) that differs from the SKU —
 * Reels Downloader's survey sent the uuid, `winback` found no product, and the Play offer never reached Android.
 */
class PlanForOfferTest {
    private val quarterly = BillingPlan(
        id = "35515f32-a5db-4b2e-b159-72e0ce4becda",
        sku = "pro-quarterly",
        name = "Quarterly",
        price = "₹299",
        interval = "quarter",
        rank = 2,
    )
    private val monthly =
        BillingPlan(
            id = "be68975d",
            sku = "pro-monthly",
            name = "Monthly",
            price = "₹149",
            interval = "month",
            rank = 1,
        )
    private val plans = listOf(monthly, quarterly)

    @Test fun matchesBySku() = assertEquals(quarterly, planForOffer(plans, "pro-quarterly"))

    @Test fun stillMatchesALegacyPlanId() = assertEquals(quarterly, planForOffer(plans, quarterly.id))

    @Test fun noSkuOrUnknown() {
        assertNull(planForOffer(plans, null))
        assertNull(planForOffer(plans, "pro-annual"))
    }
}
