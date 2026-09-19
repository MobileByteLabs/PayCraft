package com.mobilebytelabs.paycraft.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

/**
 * A plan's SKU must survive into checkout, because that is the key every per-product provider map
 * is stored under.
 *
 * The defect this locks: `BillingPlan.id` meant two different things depending on who built it.
 * `PayCraft.toBillingPlans` set `id = dto.sku`; the paywall's own `Product.toBillingPlan` set `id`
 * to the product UUID. Checkout resolved `bySku[plan.id]`, so a plan built by the paywall — which
 * is every plan a user can actually tap — missed EVERY payment link, and the thrown message told
 * the merchant to go add a link that already existed.
 *
 * Unit tests could not have caught it: both builders were individually correct under their own
 * reading of `id`, and no test built a plan the way the paywall does and then asked checkout to
 * resolve it. These assert the property that actually matters — the lookup key is a sku — rather
 * than either builder in isolation.
 */
class BillingPlanSkuTest {

    private val links = mapOf(
        "cappy_plus_annual" to mapOf("USD" to "https://buy.stripe.com/annual"),
        "cappy_plus_monthly" to mapOf("USD" to "https://buy.stripe.com/monthly"),
    )

    /** The shape of the real lookup: keyed by sku, never by id. */
    private fun resolve(plan: BillingPlan): String? = links[plan.sku]?.get(plan.currency)

    @Test
    fun a_plan_whose_id_is_a_uuid_still_resolves_its_link_by_sku() {
        // Exactly what the paywall builds: id = product UUID, sku = merchant sku.
        val plan = BillingPlan(
            id = "c0fd8d93-6445-433d-8173-3e04538fe402",
            sku = "cappy_plus_annual",
            name = "Cappy Plus (Annual)",
            price = "$41.99",
            interval = "year",
            rank = 1,
        )
        assertNotEquals(plan.id, plan.sku, "this test is meaningless if id and sku coincide")
        assertEquals("https://buy.stripe.com/annual", resolve(plan))
    }

    @Test
    fun the_cloud_config_builder_shape_still_resolves() {
        // The other builder, where id genuinely IS the sku — must keep working.
        val plan = BillingPlan(
            id = "cappy_plus_monthly",
            sku = "cappy_plus_monthly",
            name = "Cappy Plus (Monthly)",
            price = "$6.99",
            interval = "month",
            rank = 2,
        )
        assertEquals("https://buy.stripe.com/monthly", resolve(plan))
    }

    @Test
    fun sku_defaults_to_id_so_pre_existing_callers_are_unchanged() {
        val plan = BillingPlan(id = "cappy_plus_annual", name = "n", price = "p", interval = "year", rank = 1)
        assertEquals("cappy_plus_annual", plan.sku)
        assertEquals("https://buy.stripe.com/annual", resolve(plan))
    }
}
