package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

/**
 * Single-entry SDK contract — `PayCraft.initialize(apiKey)` is the only public surface.
 *
 * These tests anchor the v2.0 promise:
 *  1. API key prefix is enforced for Cloud / SelfHosted backends.
 *  2. Mock backend bypasses the prefix check (used by previews + UI tests).
 *  3. Mock backend wires a fully-formed [PayCraftConfig] synchronously so consumers
 *     can read `PayCraft.requireConfig()` immediately after `initialize()` returns.
 */
class InitializeTest {

    @Test
    fun initialize_with_pk_test_prefix_succeeds() {
        PayCraft.initialize(
            apiKey = "pk_test_anything",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuiteConfig()),
        )
        assertEquals(ConfigSource.Mock, PayCraft.requireConfig().source)
    }

    @Test
    fun initialize_with_pk_live_prefix_succeeds() {
        PayCraft.initialize(
            apiKey = "pk_live_anything",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuiteConfig()),
        )
        assertEquals("pk_live_anything", PayCraft.requireConfig().apiKey)
    }

    @Test
    fun initialize_rejects_unprefixed_api_key_against_cloud_backend() {
        assertFailsWith<IllegalArgumentException> {
            PayCraft.initialize(apiKey = "bare-key", backend = PayCraftBackend.Cloud)
        }
    }

    @Test
    fun initialize_allows_any_apiKey_against_mock_backend() {
        // Mock backend bypasses prefix enforcement so test apps don't need a real key.
        PayCraft.initialize(
            apiKey = "literally-anything",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuiteConfig()),
        )
        assertEquals("literally-anything", PayCraft.requireConfig().apiKey)
    }

    @Test
    fun mock_backend_wires_config_synchronously() {
        PayCraft.initialize(
            apiKey = "pk_test_sync",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuiteConfig()),
        )
        // Immediately after initialize() returns, requireConfig() must succeed and
        // expose the products mapped from SuiteConfig.
        val config = PayCraft.requireConfig()
        assertEquals(1, config.plans.size)
        assertEquals("monthly", config.plans.first().id)
        assertNotNull(PayCraft.suiteConfig)
    }

    private fun minimalSuiteConfig(): SuiteConfig = SuiteConfig(
        tenantId = "test-tenant",
        products = listOf(
            ProductDto(
                id = "p1",
                sku = "monthly",
                type = "subscription",
                displayName = "Monthly",
                interval = "month",
                basePriceCents = 999,
                baseCurrency = "USD",
            ),
        ),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinks = mapOf("monthly" to "https://test.link/monthly"),
            ),
        ),
        paywall = PaywallDto(supportEmail = "support@example.com"),
    )
}
