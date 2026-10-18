package com.mobilebytelabs.paycraft.ui

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlin.test.Test

/**
 * Compose UI tests for [UpsellBannerCard] — the body behind [PayCraftPlanBannerStyle.Upsell].
 *
 * It was the public `PayCraftPremiumBanner` until that merged into [PayCraftPlanBanner] as a style:
 * two public composables observing entitlement to draw a card, differing only in what a paying
 * user sees. These assertions are unchanged; only the name they drive is.
 *
 * Exercises DTO-driven copy (via [LocalPayCraftConfig]) and per-call *Override params,
 * plus the billing-state-aware behavior (shimmer while loading, collapse when premium,
 * upgrade card when free). Every copy test injects a [FakeBillingManager] pinned to
 * [BillingState.Free] so the banner renders its upgrade card (a null manager now renders
 * a shimmer, so the copy would otherwise be absent).
 *
 * Uses [runComposeUiTest] (commonTest-friendly) matching the pattern in PaywallTemplateTest.
 */
@OptIn(ExperimentalTestApi::class)
class UpsellBannerCardTest {

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun suiteConfig(paywall: PaywallDto) = SuiteConfig(
        tenantId = "test-tenant",
        paywall = paywall,
    )

    /** Free-state manager — the copy tests assert the upgrade card is rendered. */
    private fun freeManager(state: BillingState = BillingState.Free) = FakeBillingManager(state)

    // ── DTO-driven copy ───────────────────────────────────────────────────────

    @Test
    fun banner_renders_dto_hero_title() = runComposeUiTest {
        val paywall = PaywallDto(heroTitle = "Level Up Your Experience")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Level Up Your Experience", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_hero_subtitle() = runComposeUiTest {
        val paywall = PaywallDto(heroSubtitle = "Unlock unlimited access for all features")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Unlock unlimited access for all features", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_cta_label() = runComposeUiTest {
        val paywall = PaywallDto(ctaGetPremium = "Go Premium Now")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Go Premium Now", substring = true).assertExists()
    }

    @Test
    fun banner_renders_dto_restore_label() = runComposeUiTest {
        val paywall = PaywallDto(restoreLabel = "Restore My Purchase")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
            }
        }
        onNodeWithText("Restore My Purchase", substring = true).assertExists()
    }

    // ── Default PaywallDto copy (no CompositionLocal provider) ───────────────

    @Test
    fun banner_uses_defaults_when_no_config_provided() = runComposeUiTest {
        // LocalPayCraftConfig defaults to null; banner falls back to PaywallDto()
        setContent {
            UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Upgrade to Premium", substring = true).assertExists()
    }

    @Test
    fun banner_default_subtitle_renders() = runComposeUiTest {
        setContent {
            UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Enjoy ad-free experience", substring = true).assertExists()
    }

    @Test
    fun banner_default_cta_renders() = runComposeUiTest {
        setContent {
            UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Get Premium", substring = true).assertExists()
    }

    @Test
    fun banner_default_restore_label_renders() = runComposeUiTest {
        setContent {
            UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = freeManager())
        }
        onNodeWithText("Restore Your Premium", substring = true).assertExists()
    }

    // ── Dashboard copy drives every string ────────────────────────────────────
    //
    // These replace four tests that asserted `titleOverride`/`subtitleOverride`/`ctaOverride`/
    // `restoreOverride` beat the DTO. Those parameters are gone — nothing outside these tests ever
    // passed one — so what is worth asserting is the path that actually ships: a dashboard edit
    // reaching all four strings.

    @Test
    fun dashboard_copy_drives_all_four_strings() = runComposeUiTest {
        val paywall = PaywallDto(
            heroTitle = "DTO Title",
            heroSubtitle = "DTO Subtitle",
            ctaGetPremium = "DTO CTA",
            restoreLabel = "DTO Restore",
        )
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                UpsellBannerCard(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    billingManager = freeManager(),
                )
            }
        }
        onNodeWithText("DTO Title", substring = true).assertExists()
        onNodeWithText("DTO Subtitle", substring = true).assertExists()
        onNodeWithText("DTO CTA", substring = true).assertExists()
        onNodeWithText("DTO Restore", substring = true).assertExists()
    }

    @Test
    fun dashboard_copy_is_the_only_source_so_host_strings_cannot_pin_it() = runComposeUiTest {
        // Regression guard for the removal. If a `*Override` parameter is ever reintroduced, the
        // banner can disagree with the paywall it links to — a user taps "Go Pro" and lands on a
        // screen headed "Upgrade to Premium". The DTO value must be what renders, always.
        val paywall = PaywallDto(heroTitle = "Dashboard Wins")
        setContent {
            CompositionLocalProvider(LocalPayCraftConfig provides suiteConfig(paywall)) {
                UpsellBannerCard(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    billingManager = freeManager(),
                )
            }
        }
        onNodeWithText("Dashboard Wins", substring = true).assertExists()
    }

    // ── Billing-state awareness (Bug B) ───────────────────────────────────────

    @Test
    fun loading_state_renders_shimmer_not_upgrade_card() = runComposeUiTest {
        setContent {
            UpsellBannerCard(
                onGetPremiumTap = {},
                onRestoreTap = {},
                billingManager = freeManager(BillingState.Loading),
            )
        }
        // Shimmer pill is present; the stale "Upgrade" copy is not.
        // The banner shimmer renders three pills, each tagged — assert at least one exists.
        onAllNodesWithTag(PayCraftTestTags.BANNER_SHIMMER).onFirst().assertExists()
        onNodeWithText("Upgrade to Premium", substring = true).assertDoesNotExist()
    }

    @Test
    fun null_manager_pre_init_renders_shimmer() = runComposeUiTest {
        // A null billing manager (pre-init / no Koin) is treated as Loading.
        setContent {
            UpsellBannerCard(onGetPremiumTap = {}, onRestoreTap = {}, billingManager = null)
        }
        // The banner shimmer renders three pills, each tagged — assert at least one exists.
        onAllNodesWithTag(PayCraftTestTags.BANNER_SHIMMER).onFirst().assertExists()
    }

    @Test
    fun premium_state_collapses_to_nothing() = runComposeUiTest {
        val premium = BillingState.Premium(
            status = SubscriptionStatus(isPremium = true, plan = "monthly"),
            trial = null,
        )
        setContent {
            UpsellBannerCard(
                onGetPremiumTap = {},
                onRestoreTap = {},
                billingManager = freeManager(premium),
            )
        }
        // Premium buyers are never upsold — no upgrade copy and no shimmer.
        onAllNodesWithText("Upgrade to Premium", substring = true).assertCountEquals(0)
        onNodeWithTag(PayCraftTestTags.BANNER_SHIMMER).assertDoesNotExist()
    }

    @Test
    fun free_state_renders_upgrade_card() = runComposeUiTest {
        setContent {
            UpsellBannerCard(
                onGetPremiumTap = {},
                onRestoreTap = {},
                billingManager = freeManager(BillingState.Free),
            )
        }
        onNodeWithText("Upgrade to Premium", substring = true).assertExists()
        onNodeWithTag(PayCraftTestTags.BANNER_SHIMMER).assertDoesNotExist()
    }
}
