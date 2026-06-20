package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import kotlin.test.Test

/**
 * Compose UI tests for [PayCraftPremiumBanner].
 *
 * Exercises DTO-driven copy (via [LocalPayCraftConfig]) and per-call *Override params.
 * Uses [runComposeUiTest] (commonTest-friendly) matching the pattern in PaywallTemplateTest.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftPremiumBannerTest {

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun suiteConfig(paywall: PaywallDto) = SuiteConfig(
        tenantId = "test-tenant",
        paywall = paywall,
    )

    // ── DTO-driven copy ───────────────────────────────────────────────────────

    @Test
    fun banner_renders_dto_hero_title() = runComposeUiTest {
        val paywall = PaywallDto(heroTitle = "Level Up Your Experience")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
            }
        }
        onNodeWithText("Level Up Your Experience", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_hero_subtitle() = runComposeUiTest {
        val paywall = PaywallDto(heroSubtitle = "Unlock unlimited access for all features")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
            }
        }
        onNodeWithText("Unlock unlimited access for all features", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_cta_label() = runComposeUiTest {
        val paywall = PaywallDto(ctaGetPremium = "Go Premium Now")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
            }
        }
        onNodeWithText("Go Premium Now", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_restore_label() = runComposeUiTest {
        val paywall = PaywallDto(restoreLabel = "Restore My Purchase")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
            }
        }
        onNodeWithText("Restore My Purchase", substring = true).assertExists()
    }

    // ── Default PaywallDto copy (no CompositionLocal provider) ───────────────

    @Test
    fun banner_uses_defaults_when_no_config_provided() = runComposeUiTest {
        // LocalPayCraftConfig defaults to null; banner falls back to PaywallDto()
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
        }
        onNodeWithText("Upgrade to Premium", substring = true).assertExists()
    }

    @Test
    fun banner_default_subtitle_renders() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
        }
        onNodeWithText("Enjoy ad-free experience", substring = true).assertExists()
    }

    @Test
    fun banner_default_cta_renders() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
        }
        onNodeWithText("Get Premium", substring = true).assertExists()
    }

    @Test
    fun banner_default_restore_label_renders() = runComposeUiTest {
        setContent {
            PayCraftPremiumBanner(onGetPremiumTap = {}, onRestoreTap = {})
        }
        onNodeWithText("Restore Your Premium", substring = true).assertExists()
    }

    // ── *Override params take precedence over DTO ─────────────────────────────

    @Test
    fun title_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(heroTitle = "DTO Title")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    titleOverride = "Pinned Title",
                )
            }
        }
        onNodeWithText("Pinned Title", substring = true).assertExists()
        // DTO value must not appear when override is set
        onNodeWithText("DTO Title").assertDoesNotExist()
    }

    @Test
    fun subtitle_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(heroSubtitle = "DTO Subtitle")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    subtitleOverride = "Pinned Subtitle",
                )
            }
        }
        onNodeWithText("Pinned Subtitle", substring = true).assertExists()
        onNodeWithText("DTO Subtitle").assertDoesNotExist()
    }

    @Test
    fun cta_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(ctaGetPremium = "DTO CTA")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    ctaOverride = "Pinned CTA",
                )
            }
        }
        onNodeWithText("Pinned CTA", substring = true).assertExists()
        onNodeWithText("DTO CTA").assertDoesNotExist()
    }

    @Test
    fun restore_override_takes_precedence_over_dto() = runComposeUiTest {
        val paywall = PaywallDto(restoreLabel = "DTO Restore")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                PayCraftPremiumBanner(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    restoreOverride = "Pinned Restore",
                )
            }
        }
        onNodeWithText("Pinned Restore", substring = true).assertExists()
        onNodeWithText("DTO Restore").assertDoesNotExist()
    }
}
