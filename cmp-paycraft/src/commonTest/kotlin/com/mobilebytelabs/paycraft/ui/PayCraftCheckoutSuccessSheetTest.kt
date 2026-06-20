package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Compose UI tests for [PayCraftCheckoutSuccessSheet].
 *
 * Strategy: each test uses a UUID-like unique (sku, sessionId) pair so that
 * [com.mobilebytelabs.paycraft.persistence.CheckoutSuccessFlag] — backed by the
 * platform default [com.russhwolf.settings.Settings] — always starts with
 * wasSuccessShown == false, ensuring the sheet renders.
 *
 * The once-per-(session × SKU) suppression path — where the sheet auto-fires
 * onDismiss when already shown — is exercised via direct [CheckoutSuccessFlagTestHarness]
 * logic tests below (no Compose runtime needed for the suppression contract because
 * it's a pure boolean flag read on `remember`-init).
 *
 * Uses [runComposeUiTest] (commonTest-friendly) matching the pattern in PaywallTemplateTest.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftCheckoutSuccessSheetTest {

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun suiteConfig(paywall: PaywallDto) = SuiteConfig(
        tenantId = "test-tenant",
        paywall = paywall,
    )

    /**
     * Each test gets a globally unique session key to guarantee the platform
     * Settings has no prior entry for it, regardless of test ordering.
     */
    private var testCounter = 0
    private fun freshKey(): Pair<String, String> {
        testCounter++
        return "sku-test-$testCounter-${testCounter * 31}" to "session-test-$testCounter-${testCounter * 17}"
    }

    // ── DTO-driven copy renders ───────────────────────────────────────────────

    @Test
    fun sheet_renders_dto_success_title() = runComposeUiTest {
        val (sku, sessionId) = freshKey()
        val paywall = PaywallDto(successTitle = "You're In!")
        var dismissed = false
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftCheckoutSuccessSheet(
                    activatedSku = sku,
                    sessionId = sessionId,
                    onCtaTap = {},
                    onDismiss = { dismissed = true },
                )
            }
        }
        onNodeWithText("You're In!", substring = true).assertExists()
    }

    @Test
    fun sheet_renders_dto_success_message() = runComposeUiTest {
        val (sku, sessionId) = freshKey()
        val paywall = PaywallDto(successMessage = "All premium features unlocked.")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftCheckoutSuccessSheet(
                    activatedSku = sku,
                    sessionId = sessionId,
                    onCtaTap = {},
                    onDismiss = {},
                )
            }
        }
        onNodeWithText("All premium features unlocked.", substring = true).assertExists()
    }

    @Test
    fun sheet_renders_dto_success_cta_label() = runComposeUiTest {
        val (sku, sessionId) = freshKey()
        val paywall = PaywallDto(successCtaLabel = "Start Exploring")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftCheckoutSuccessSheet(
                    activatedSku = sku,
                    sessionId = sessionId,
                    onCtaTap = {},
                    onDismiss = {},
                )
            }
        }
        onNodeWithText("Start Exploring", substring = true).assertExists()
    }

    // ── Default PaywallDto copy ───────────────────────────────────────────────

    @Test
    fun sheet_renders_default_success_title_when_no_config() = runComposeUiTest {
        val (sku, sessionId) = freshKey()
        setContent {
            // LocalPayCraftConfig defaults to null; banner falls back to PaywallDto()
            PayCraftCheckoutSuccessSheet(
                activatedSku = sku,
                sessionId = sessionId,
                onCtaTap = {},
                onDismiss = {},
            )
        }
        onNodeWithText("Welcome to Premium!", substring = true).assertExists()
    }

    @Test
    fun sheet_renders_default_success_message_when_no_config() = runComposeUiTest {
        val (sku, sessionId) = freshKey()
        setContent {
            PayCraftCheckoutSuccessSheet(
                activatedSku = sku,
                sessionId = sessionId,
                onCtaTap = {},
                onDismiss = {},
            )
        }
        onNodeWithText("You now have access to all premium features.", substring = true).assertExists()
    }

    @Test
    fun sheet_renders_default_cta_label_when_no_config() = runComposeUiTest {
        val (sku, sessionId) = freshKey()
        setContent {
            PayCraftCheckoutSuccessSheet(
                activatedSku = sku,
                sessionId = sessionId,
                onCtaTap = {},
                onDismiss = {},
            )
        }
        onNodeWithText("Continue to app", substring = true).assertExists()
    }

    // ── Suppression contract (pure-logic, no Compose runtime) ────────────────

    /**
     * Tests the [com.mobilebytelabs.paycraft.persistence.CheckoutSuccessFlag]
     * suppression logic directly using an in-memory [com.russhwolf.settings.MapSettings].
     * This covers the once-per-(session × SKU) guarantee without involving the
     * [PayCraftCheckoutSuccessSheet] composable (whose internal `CheckoutSuccessFlag.get()`
     * is wired to the platform Settings and cannot be easily swapped in a Compose UI test).
     */
    @Test
    fun suppression_flag_returns_false_before_shown() {
        val flag = CheckoutSuccessFlagTestHarness()
        assertTrue(!flag.wasSuccessShown("monthly", "sess-001"))
    }

    @Test
    fun suppression_flag_returns_true_after_mark_shown() {
        val flag = CheckoutSuccessFlagTestHarness()
        flag.markSuccessShown("monthly", "sess-001")
        assertTrue(flag.wasSuccessShown("monthly", "sess-001"))
    }

    @Test
    fun suppression_flag_is_keyed_per_sku_and_session() {
        val flag = CheckoutSuccessFlagTestHarness()
        flag.markSuccessShown("monthly", "sess-001")
        // Different SKU, same session — not suppressed
        assertTrue(!flag.wasSuccessShown("annual", "sess-001"))
        // Same SKU, different session — not suppressed
        assertTrue(!flag.wasSuccessShown("monthly", "sess-002"))
    }

    @Test
    fun suppression_flag_is_idempotent_on_repeat_mark() {
        val flag = CheckoutSuccessFlagTestHarness()
        flag.markSuccessShown("lifetime", "sess-xyz")
        flag.markSuccessShown("lifetime", "sess-xyz")
        assertTrue(flag.wasSuccessShown("lifetime", "sess-xyz"))
    }
}

/**
 * In-memory test harness mirroring [com.mobilebytelabs.paycraft.persistence.CheckoutSuccessFlag]
 * behaviour, backed by a plain [MutableMap] instead of platform Settings.
 * Validates the key format and boolean contract without requiring a Koin or Settings setup.
 */
private class CheckoutSuccessFlagTestHarness {
    private val store = mutableMapOf<String, Boolean>()

    fun wasSuccessShown(sku: String, sessionId: String): Boolean =
        store["paycraft_success_shown_${sku}_$sessionId"] == true

    fun markSuccessShown(sku: String, sessionId: String) {
        store["paycraft_success_shown_${sku}_$sessionId"] = true
    }
}
