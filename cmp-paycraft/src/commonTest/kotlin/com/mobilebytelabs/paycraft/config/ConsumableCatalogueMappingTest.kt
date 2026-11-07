package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.toPayCraftConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * `SuiteConfig.toPayCraftConfig()` must carry CONSUMABLES through to `BillingPlan`.
 *
 * ## The bug this exists to prevent, and why nothing caught it
 *
 * The mapper opened with `filter { type == "subscription" || type == "lifetime" }` and then, 60
 * lines later, set `isConsumable = dto.type == "consumable"` — a line that could never be true,
 * because the only rows reaching it had already been filtered to two types that are not it. So the
 * flag was permanently false for every product in every app, and three unrelated features failed
 * in ways that each looked like their own bug:
 *
 *  - `PayCraftStoreSection` rendered "No products available" for a tenant with three live packs;
 *  - `ConsumableDrainer` filters `plans.filter { it.isConsumable }`, matched nothing, and so never
 *    moved a purchased balance into the host — money taken, units never delivered;
 *  - `PayCraftBillingManager.isConsumableStoreProduct` returned false, so a pack purchase was
 *    ACKNOWLEDGED instead of CONSUMED. Play then treats it as owned forever and refuses to sell it
 *    again. That one is not even recoverable by a later fix for the user it happened to.
 *
 * **Every existing test still passed**, and that is the part worth keeping in mind. `TrialConfigTest`
 * proves `ProductDto` parses `type` correctly — it does, the DTO was never wrong. `StoreCatalogueTest`
 * proves the `isConsumable || interval == "lifetime"` filter selects packs — it does, given plans
 * that have the flag set. Both tested a side of the mapper without testing THROUGH it, so the one
 * step that dropped the row was the one step nothing exercised.
 *
 * Hence these assertions go through the real `toPayCraftConfig` (it is `internal`, so commonTest
 * reaches it) rather than re-deriving the mapping. A test that rebuilt the filter would agree with
 * whatever the filter happens to be, including a wrong one.
 */
class ConsumableCatalogueMappingTest {

    private fun product(sku: String, type: String, interval: String? = null, grant: Int = 0, order: Int = 0) =
        ProductDto(
            id = "id_$sku",
            sku = sku,
            type = type,
            displayName = sku,
            interval = interval,
            basePriceCents = 199,
            baseCurrency = "USD",
            grantQuantity = grant,
            displayOrder = order,
        )

    private fun configOf(vararg products: ProductDto) = SuiteConfig(
        tenantId = "t",
        products = products.toList(),
    )

    /**
     * Run the REAL mapper. Mock backend because the catalogue mapping has no network in it — a
     * Cloud backend would make this test depend on the SDK's Supabase constants to assert a pure
     * list transform.
     */
    private fun SuiteConfig.mapped() =
        toPayCraftConfig(backend = PayCraftBackend.Mock(staticConfig = this), apiKey = "pk_test_mapping")

    @Test
    fun a_consumable_survives_the_mapper_and_carries_its_flag_and_grant() {
        val plans = configOf(
            product("cappy_plus_monthly", type = "subscription", interval = "month", order = 0),
            product("cappy_ripples_300", type = "consumable", grant = 300, order = 1),
        ).mapped().plans

        assertEquals(2, plans.size, "a consumable must not be filtered out of the catalogue")
        val pack = plans.single { it.sku == "cappy_ripples_300" }
        assertTrue(pack.isConsumable, "isConsumable must be true for type=consumable")
        assertEquals(300, pack.grantQuantity)
    }

    @Test
    fun a_one_time_product_also_survives() {
        // `one_time` was dropped by the same allowlist. It is not a consumable — it must reach the
        // catalogue with the flag OFF, or the drainer would try to debit a balance it never grants.
        val plans = configOf(product("lifetime_unlock", type = "one_time")).mapped().plans
        assertEquals(1, plans.size)
        assertEquals(false, plans.single().isConsumable)
    }

    @Test
    fun a_subscription_is_never_marked_consumable() {
        // The inverse error is worse than the original: a subscription finished with consumeAsync
        // would be re-sellable to someone who already pays.
        val plans = configOf(
            product("monthly", type = "subscription", interval = "month"),
            product("lifetime", type = "lifetime"),
        ).mapped().plans
        assertTrue(plans.none { it.isConsumable })
    }

    @Test
    fun a_trial_is_still_excluded_from_the_catalogue() {
        // The one deliberate exclusion. A trial is not independently sellable — it attaches to a
        // parent product and is folded in as trialDays. Widening the filter must not resurrect it
        // as a purchasable row.
        val plans = configOf(
            product("monthly", type = "subscription", interval = "month"),
            product("monthly_trial", type = "trial"),
        ).mapped().plans
        assertEquals(listOf("monthly"), plans.map { it.sku })
    }

    @Test
    fun an_unknown_future_type_is_kept_rather_than_silently_dropped() {
        // This is the actual regression guard. The defect was not "consumable was missing from a
        // list" — it was that the list was an ALLOWLIST, so any type the server learned and the SDK
        // did not vanished without a word, far from where the symptom appeared. A denylist fails
        // loudly instead: an unknown type shows up in the catalogue, where someone notices it.
        val plans = configOf(product("mystery", type = "something_invented_next_quarter"))
            .mapped().plans
        assertEquals(1, plans.size, "an unrecognised product type must not be silently dropped")
    }

    @Test
    fun the_store_subset_and_the_paywall_subset_partition_the_catalogue() {
        // Store and paywall read the SAME plans list and each take a half. Proven together because
        // the failure mode is a product that falls in BOTH (a pack offered as an upgrade) or in
        // NEITHER (bought, undeliverable) — and either way one list alone looks correct.
        val config = configOf(
            product("monthly", type = "subscription", interval = "month", order = 0),
            product("ripples_300", type = "consumable", grant = 300, order = 1),
        ).mapped()

        val store = config.plans.filter { it.isConsumable || it.interval == "lifetime" }
        val paywall = config.plans.filterNot { it.isConsumable }

        assertEquals(listOf("ripples_300"), store.map { it.sku })
        assertEquals(listOf("monthly"), paywall.map { it.sku })
    }
}
