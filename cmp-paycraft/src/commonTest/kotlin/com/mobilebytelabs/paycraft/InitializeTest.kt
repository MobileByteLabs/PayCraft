package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Single-entry SDK contract — `PayCraft.initialize(apiKey)` is the only public surface.
 *
 * These tests anchor the v2.0 promise:
 *  1. The key must be PUBLISHABLE (`pk_…`) for Cloud / SelfHosted backends — a secret key is
 *     refused. Mode is NOT required in the prefix (one key per app); see the one-key block below.
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

    // ── One key per app ────────────────────────────────────────────────────────
    // These five anchor the completed one-key model. Before it, `initialize()` demanded a
    // `pk_test_`/`pk_live_` prefix while `isConfigured` and `mode` had already been rewritten to
    // accept and interpret a plain `pk_…` — so those paths were dead code and a one-key app
    // crashed at boot. The guard now admits any publishable key and still refuses a secret one.
    //
    // Nothing here asserts the BUILD-TYPE fallback (plain key → Test on debug, Live on release).
    // `PlatformInfo.isDebugBuild` is deliberately platform-specific — jdwp detection on JVM,
    // `isDebugBinary` on native, hardcoded `false` on js/wasmJs — so its value is not knowable
    // from commonTest and asserting it here would be a flake that varies by target, not a
    // contract. What IS deterministic is pinned below: an explicit override wins, and the key's
    // prefix changes nothing (asserted as an equivalence across all three spellings).

    @Test
    fun initialize_accepts_plain_pk_key_against_cloud_backend() {
        // The one-key norm, and the case that was impossible before: no mode in the prefix.
        // Mock cannot prove this — it bypasses the guard entirely — so the backend must be real.
        PayCraft.initialize(apiKey = "pk_oneKeyPerApp", backend = PayCraftBackend.Cloud)
        assertEquals("pk_oneKeyPerApp", PayCraft.apiKey)
        assertTrue(PayCraft.isConfigured, "a plain pk_ key must read as configured")
    }

    @Test
    fun initialize_rejects_secret_key_against_cloud_backend() {
        // The half of the guard that must NOT relax. A secret key in client source is the leak
        // KEY_TIERING exists to prevent, and it has to fail at boot rather than ship in a binary.
        assertFailsWith<IllegalArgumentException> {
            PayCraft.initialize(apiKey = "sk_live_not_publishable", backend = PayCraftBackend.Cloud)
        }
    }

    @Test
    fun placeholder_key_initializes_but_reports_unconfigured() {
        // `pk_YOUR…` now passes the guard and is caught by isConfigured, which serves a Free
        // entitlement instead of throwing — the documented graceful path for a host that wires
        // billing unconditionally. That branch was unreachable while the guard threw first.
        PayCraft.initialize(apiKey = "pk_YOUR_PUBLISHABLE_KEY", backend = PayCraftBackend.Cloud)
        assertFalse(PayCraft.isConfigured, "a template placeholder must read as unconfigured")
    }

    @Test
    fun key_prefix_does_not_pin_mode() {
        // INVERTED 2026-10-08. This test previously asserted that a `pk_test_`/`pk_live_` prefix
        // pinned the mode, honouring legacy two-key apps. That behaviour WAS the F35 defect: a
        // pinning prefix short-circuits the build-type rule, so an app shipping its one `pk_live_`
        // key resolved LIVE in debug builds and could take real money in development. All nine
        // production tenants held such keys, so every consumer app was affected.
        //
        // The prefix is now cosmetic — all three spellings resolve identically, from the build
        // type alone. Asserting mode == Test/Live here would re-flake per target, so the contract
        // under test is the EQUIVALENCE: whatever the build type yields, the spelling cannot change
        // it. An app that wants live billing in debug says so via InitOptions.modeOverride.
        val modes = listOf("pk_test_legacy", "pk_live_legacy", "pk_modeless").map { key ->
            PayCraft.initialize(
                apiKey = key,
                backend = PayCraftBackend.Mock(staticConfig = minimalSuiteConfig()),
            )
            PayCraft.mode
        }
        assertEquals(1, modes.toSet().size, "key prefix must not change the resolved mode: $modes")
        assertTrue(
            modes.all { it == PayCraft.Mode.Test || it == PayCraft.Mode.Live },
            "a configured SDK must never resolve Unknown: $modes",
        )
    }

    @Test
    fun mode_override_outranks_the_build_type() {
        // Precedence step 1 beats step 2 (the build type) — exercising the live checkout from a
        // debug build, or pinning a mode on a platform with no build-type signal at all. This is
        // now the ONLY way to override, the prefix having stopped carrying mode.
        PayCraft.initialize(
            apiKey = "pk_test_legacy",
            backend = PayCraftBackend.Mock(staticConfig = minimalSuiteConfig()),
            options = InitOptions(modeOverride = PayCraft.Mode.Live),
        )
        assertEquals(PayCraft.Mode.Live, PayCraft.mode)
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
                testPaymentLinksBySku = mapOf("monthly" to mapOf("USD" to "https://test.link/monthly")),
            ),
        ),
        paywall = PaywallDto(supportEmail = "support@example.com"),
    )
}
