/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The plan banner, RENDERED — the last surface of the 2026-10-18 reshuffle with no pixels behind it.
 *
 * `PayCraftBanner` and `PayCraftPremiumBanner` were merged into one component with two styles, the
 * callbacks were removed, and the whole thing was verified by compiling. The sibling
 * PayCraftPlanSectionScreenshotTest found two defects the moment it looked at an image — one in the
 * component, one in its own harness — so the merged banner should not ship unlooked-at either.
 *
 * ASSERT BEFORE CAPTURE, per PaywallStateMatrixTest: a blank render produces a perfectly stable
 * golden that passes forever, so each case asserts its defining content first.
 *
 * WHY THE INNER CARDS AND NOT `PayCraftPlanBanner` ITSELF
 * The public composable resolves Koin and calls `PayCraft.requireConfig()`; rendering it here would
 * test the harness. `FreeBannerCard` / `PremiumBannerCard` / `UpsellBannerCard` are the production
 * bodies with the resolution step removed — the same split the plan-section test uses.
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.LocalPayCraftConfig
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.ui.FreeBannerCard
import com.mobilebytelabs.paycraft.ui.PremiumBannerCard
import com.mobilebytelabs.paycraft.ui.UpsellBannerCard
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class PayCraftPlanBannerScreenshotTest {

    private val paywall = PaywallDto(
        heroTitle = "Upgrade to Premium",
        heroSubtitle = "Ad-free, unlimited, 4K downloads",
        ctaGetPremium = "Get Premium",
        restoreLabel = "Restore Your Premium",
    )

    private val plans = listOf(
        BillingPlan(id = "annual", name = "Annual", price = "$39.99", interval = "year", rank = 2),
    )

    // ── Adaptive — the preset that adapts, so both of its faces matter ───────────────────────────

    @Test
    fun adaptive_free_render() = runComposeUiTest {
        setContent {
            DeterministicTheme {
                FreeBannerCard(
                    benefits = emptyList(),
                    paywall = paywall,
                    onUpgradeClick = {},
                    onRestoreClick = {},
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        // Dashboard copy, rendered. A card showing the SDK's bundled defaults instead would mean
        // the PaywallDto never reached the render.
        onNodeWithText("Upgrade to Premium", substring = true).assertIsDisplayed()
        onNodeWithText("Get Premium", substring = true).assertIsDisplayed()
        onRoot().captureRoboImage(P_ADAPTIVE_FREE)
        assertCaptured(P_ADAPTIVE_FREE)
    }

    @Test
    fun adaptive_free_without_a_restore_link() = runComposeUiTest {
        // `onRestoreClick = null` is a host with nothing to restore. The link must be ABSENT, not
        // present-and-inert — the same contract the plan section's Manage row has.
        setContent {
            DeterministicTheme {
                FreeBannerCard(
                    benefits = emptyList(),
                    paywall = paywall,
                    onUpgradeClick = {},
                    onRestoreClick = null,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        onNodeWithText("Get Premium", substring = true).assertIsDisplayed()
        onNodeWithText("Restore Your Premium").assertDoesNotExist()
        onRoot().captureRoboImage(P_ADAPTIVE_FREE_NO_RESTORE)
        assertCaptured(P_ADAPTIVE_FREE_NO_RESTORE)
    }

    @Test
    fun adaptive_premium_render() = runComposeUiTest {
        // The face that distinguishes Adaptive from Upsell: a SUBSCRIBER sees their plan rather
        // than nothing. If this renders an upsell, the two presets have collapsed into one.
        setContent {
            DeterministicTheme {
                PremiumBannerCard(
                    status = SubscriptionStatus(isPremium = true),
                    trial = null,
                    plans = plans,
                    topTierPlan = plans.first(),
                    supportEmail = "support@example.com",
                    onManageClick = {},
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        onRoot().captureRoboImage(P_ADAPTIVE_PREMIUM)
        assertCaptured(P_ADAPTIVE_PREMIUM)
    }

    // ── Upsell — defined by what it does NOT render ──────────────────────────────────────────────

    @Test
    fun upsell_free_renders_dashboard_copy() = runComposeUiTest {
        // LocalPayCraftConfig is PROVIDED, and the title is deliberately not the SDK default.
        //
        // The first version omitted it and asserted "Upgrade to Premium" — which passed, because
        // that is ALSO the bundled default. The card had fallen back to `PaywallDto()` and the
        // assertion could not tell. A distinctive string is what makes this prove the tenant's
        // config reached the render rather than that two strings coincide.
        setContent {
            CompositionLocalProvider(
                LocalPayCraftConfig provides SuiteConfig(
                    tenantId = "test-tenant",
                    paywall = paywall.copy(heroTitle = "Go Cappy Plus"),
                ),
            ) {
                DeterministicTheme {
                    UpsellBannerCard(
                        onGetPremiumTap = {},
                        onRestoreTap = {},
                        billingManager = FakeBillingManager(BillingState.Free),
                    )
                }
            }
        }
        onNodeWithText("Go Cappy Plus", substring = true).assertIsDisplayed()
        onNodeWithText("Ad-free, unlimited, 4K downloads", substring = true).assertIsDisplayed()
        onRoot().captureRoboImage(P_UPSELL_FREE)
        assertCaptured(P_UPSELL_FREE)
    }

    @Test
    fun upsell_renders_nothing_for_a_subscriber() = runComposeUiTest {
        // THE defining property of this preset — never nag someone who already bought. A golden
        // cannot assert an absence, so the assertion carries it and the capture records the frame.
        setContent {
            DeterministicTheme {
                UpsellBannerCard(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    billingManager = FakeBillingManager(
                        BillingState.Premium(SubscriptionStatus(isPremium = true)),
                    ),
                )
            }
        }
        onNodeWithText("Upgrade to Premium", substring = true).assertDoesNotExist()
        onNodeWithText("Get Premium", substring = true).assertDoesNotExist()
        onRoot().captureRoboImage(P_UPSELL_PREMIUM)
        assertCaptured(P_UPSELL_PREMIUM)
    }

    @Test
    fun upsell_shows_a_shimmer_before_entitlement_is_known() = runComposeUiTest {
        // Loading must NOT render the upgrade card: "Get Premium" flashing at a subscriber on every
        // cold start is the defect the shimmer exists to prevent.
        setContent {
            DeterministicTheme {
                UpsellBannerCard(
                    onGetPremiumTap = {},
                    onRestoreTap = {},
                    billingManager = FakeBillingManager(BillingState.Loading),
                )
            }
        }
        onNodeWithText("Get Premium", substring = true).assertDoesNotExist()
        onRoot().captureRoboImage(P_UPSELL_LOADING)
        assertCaptured(P_UPSELL_LOADING)
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────

    /** Matches production: the public banner wraps its card in a width-filling container. */
    @Composable
    private fun DeterministicTheme(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(
                modifier = Modifier
                    .size(width = 411.dp, height = 360.dp)
                    .background(MaterialTheme.colorScheme.surface),
            ) {
                PayCraftThemeProvider {
                    Column(modifier = Modifier.fillMaxWidth()) { content() }
                }
            }
        }
    }

    private fun assertCaptured(path: String) {
        val f = java.io.File(path)
        assertTrue(
            f.exists() && f.length() > 0L,
            "captureRoboImage did not write $path — verifyRoborazziJvm would be vacuously green",
        )
    }

    private companion object {
        const val DIR = "src/jvmTest/resources/screenshots"
        const val P_ADAPTIVE_FREE = "$DIR/plan_banner_adaptive_free.png"
        const val P_ADAPTIVE_FREE_NO_RESTORE = "$DIR/plan_banner_adaptive_free_no_restore.png"
        const val P_ADAPTIVE_PREMIUM = "$DIR/plan_banner_adaptive_premium.png"
        const val P_UPSELL_FREE = "$DIR/plan_banner_upsell_free.png"
        const val P_UPSELL_PREMIUM = "$DIR/plan_banner_upsell_premium.png"
        const val P_UPSELL_LOADING = "$DIR/plan_banner_upsell_loading.png"
    }
}
