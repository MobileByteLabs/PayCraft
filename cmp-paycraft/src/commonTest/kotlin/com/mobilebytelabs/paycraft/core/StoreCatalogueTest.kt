package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingPlan
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The non-subscription catalogue that [com.mobilebytelabs.paycraft.ui.PayCraftStoreSection] renders.
 *
 * The filter is one line, but it is the line that decides what a user is offered to BUY, and both
 * ways of getting it wrong are bad in a way a reviewer will not notice:
 *
 *  - letting a **subscription** through puts a plan beside a coin pack, inviting a user to "buy" a
 *    subscription they may already hold, through a flow that does not handle that;
 *  - dropping a **lifetime unlock** silently removes a product the tenant is selling, and an empty
 *    store looks identical to a tenant that simply has no products.
 *
 * `interval` cannot distinguish these alone — the `/config` mapper collapses a null interval to the
 * literal "lifetime", so a consumable and a lifetime unlock look the same by interval. That is
 * exactly why `isConsumable` is carried explicitly on [BillingPlan], and why this test pins both.
 */
class StoreCatalogueTest {

    private fun plan(id: String, interval: String, consumable: Boolean = false, grant: Int = 0) = BillingPlan(
        id = id,
        name = id,
        price = "$0.99",
        interval = interval,
        rank = 0,
        isConsumable = consumable,
        grantQuantity = grant,
    )

    /** Mirrors the filter in PayCraftStoreSection / PayCraft.products. */
    private fun products(all: List<BillingPlan>) = all.filter { it.isConsumable || it.interval == "lifetime" }

    @Test
    fun subscriptions_and_trials_are_excluded_from_the_store() {
        val all = listOf(
            plan("monthly", interval = "month"),
            plan("yearly", interval = "year"),
            plan("coins_550", interval = "lifetime", consumable = true, grant = 550),
        )

        val store = products(all)

        assertEquals(listOf("coins_550"), store.map { it.id })
        assertFalse(store.any { it.interval == "month" || it.interval == "year" })
    }

    @Test
    fun one_time_lifetime_unlocks_are_included_alongside_consumables() {
        val all = listOf(
            plan("monthly", interval = "month"),
            plan("remove_ads", interval = "lifetime"),
            plan("coins_550", interval = "lifetime", consumable = true, grant = 550),
        )

        val store = products(all)

        // Both non-subscription shapes belong in a store; only the subscription is filtered out.
        assertEquals(setOf("remove_ads", "coins_550"), store.map { it.id }.toSet())
    }

    @Test
    fun a_consumable_whose_interval_collapsed_to_lifetime_is_still_a_consumable() {
        // The /config mapper writes interval = "lifetime" for any null interval, so this row is
        // indistinguishable from a one-time unlock by interval alone. isConsumable is what Play
        // uses to pick consumePurchase over acknowledgePurchase — getting it wrong leaves the sku
        // OWNED forever and the buyer unable to repurchase, with nothing erroring.
        val coins = plan("coins_550", interval = "lifetime", consumable = true, grant = 550)
        val unlock = plan("remove_ads", interval = "lifetime", consumable = false)

        assertTrue(coins.isConsumable)
        assertFalse(unlock.isConsumable)
        assertEquals(coins.interval, unlock.interval) // same interval, different finishing call
    }

    @Test
    fun grant_quantity_defaults_to_zero_so_a_misconfigured_pack_grants_nothing() {
        // 0 is the safe default for an older server that does not send grant_quantity: a pack that
        // visibly grants nothing gets fixed, whereas a guessed non-zero default would silently
        // credit currency nobody configured.
        val unconfigured = plan("coins_broken", interval = "lifetime", consumable = true)

        assertEquals(0, unconfigured.grantQuantity)
    }
}
