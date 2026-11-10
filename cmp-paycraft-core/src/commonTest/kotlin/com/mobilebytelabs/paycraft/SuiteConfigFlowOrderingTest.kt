package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * Pins the `applySuiteConfig` ordering contract that the paywall ViewModel relies on.
 *
 * The ViewModel collects [PayCraft.suiteConfigFlow] and re-reads [PayCraft.config] on
 * every emission to repopulate plans + the default popular-plan selection. That only
 * works if `config` is assigned BEFORE the flow emits — otherwise a cold-start collector
 * fires while `config` still holds the previous value, drops the plans, and never
 * re-fires (the StateFlow value doesn't change again), leaving an empty paywall.
 *
 * Regression: emit-first ordering shipped an empty paywall (no plans, base-purple hero)
 * on cold cache. This test fails under emit-first ordering and passes under config-first.
 */
class SuiteConfigFlowOrderingTest {

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    fun flowEmission_seesResolvedConfig_andResolvesPopularPlan() = runTest {
        PayCraft.initialize(
            apiKey = "pk_test_ordering",
            backend = PayCraftBackend.Mock(staticConfig = oneProductSuite()),
        )

        // Mirror the ViewModel collector: record the plan count visible at the instant
        // the flow fires (UnconfinedTestDispatcher runs the collector eagerly on emit).
        val plansSeenAtEmit = mutableListOf<Int>()
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            PayCraft.suiteConfigFlow.collect { suite ->
                if (suite != null) plansSeenAtEmit.add(PayCraft.config?.plans?.size ?: -1)
            }
        }

        // Cold-start race: the freshly-fetched config arrives after the collector is live.
        PayCraft.applySuiteConfig(fourProductSuite())

        // Emit-first ordering would record 1 here (stale config at emit time); config-first
        // ordering guarantees the collector observes the resolved 4-plan config.
        assertEquals(4, plansSeenAtEmit.last())

        val plans = PayCraft.config?.plans
        assertNotNull(plans)
        assertEquals(4, plans.size)
        assertEquals(1, plans.count { it.isPopular })
        assertEquals("pro-quarterly", plans.first { it.isPopular }.id)
        job.cancel()
    }

    private fun product(id: String, sku: String, order: Int) = ProductDto(
        id = id,
        sku = sku,
        type = "subscription",
        displayName = sku,
        interval = "month",
        basePriceCents = 999,
        baseCurrency = "USD",
        displayOrder = order,
    )

    private fun oneProductSuite() = SuiteConfig(
        tenantId = "t",
        products = listOf(product("p1", "pro-monthly", 0)),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinksBySku = mapOf("pro-monthly" to mapOf("USD" to "https://t/l")),
            ),
        ),
        paywall = PaywallDto(supportEmail = "support@example.com"),
    )

    private fun fourProductSuite() = SuiteConfig(
        tenantId = "t",
        products = listOf(
            product("p1", "pro-monthly", 0),
            product("p2", "pro-quarterly", 1),
            product("p3", "pro-semiannual", 2),
            product("p4", "pro-annual", 3),
        ),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinksBySku = mapOf("pro-monthly" to mapOf("USD" to "https://t/l")),
            ),
        ),
        paywall = PaywallDto(popularPlanSku = "pro-quarterly", primaryColor = "#3a91ee"),
    )
}
