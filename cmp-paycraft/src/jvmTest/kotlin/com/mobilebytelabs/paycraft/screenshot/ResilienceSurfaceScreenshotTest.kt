/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * Roborazzi goldens for the three surfaces the resilience chain introduces (AC-20..AC-22).
 *
 * These exist because RC-1..RC-6 are structural: they prove the sealed outcome is wired, not that
 * anything renders. That distinction is not academic — on this very sub-plan the structural gate
 * went green while the module did not compile. A composable that compiles can still render a blank
 * box, and these surfaces only ever appear when something has already gone wrong, so nobody would
 * see the blank box in normal use.
 *
 *   ./gradlew :cmp-paycraft:recordRoborazziJvm --no-configuration-cache   # (re)generate
 *   ./gradlew :cmp-paycraft:verifyRoborazziJvm --no-configuration-cache   # gate
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.config.ConfigResult
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.Money
import com.mobilebytelabs.paycraft.model.Product
import com.mobilebytelabs.paycraft.ui.components.BuiltInPaywall
import com.mobilebytelabs.paycraft.ui.components.ConfigUnavailable
import com.mobilebytelabs.paycraft.ui.components.StaleConfigNotice
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class ResilienceSurfaceScreenshotTest {

    /** AC-22 — the terminal state a user sees when every layer failed. */
    @Test
    fun config_unavailable_offline_render() = runComposeUiTest {
        setContent {
            DeterministicTheme {
                ConfigUnavailable(
                    result = ConfigResult.Failed(ConfigResult.Failed.Reason.OFFLINE),
                    onRetry = {},
                )
            }
        }
        onNodeWithTag(PayCraftTestTags.OFFLINE_MESSAGE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.CONFIG_FAILED_RETRY).assertIsDisplayed()
        onRoot().captureRoboImage(PATH_UNAVAILABLE)
        assertCaptured(PATH_UNAVAILABLE)
    }

    /**
     * AC-22 — the same surface for a fault on our side.
     *
     * Captured separately from the offline case on purpose: the two differ only in wording, and
     * wording is the entire product decision here. A single golden would let one silently become
     * the other.
     */
    @Test
    fun config_unavailable_http_error_render() = runComposeUiTest {
        setContent {
            DeterministicTheme {
                ConfigUnavailable(
                    result = ConfigResult.Failed(ConfigResult.Failed.Reason.HTTP_ERROR),
                    onRetry = {},
                )
            }
        }
        onNodeWithTag(PayCraftTestTags.CONFIG_FAILED_MESSAGE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.CONFIG_FAILED_RETRY).assertIsDisplayed()
        onRoot().captureRoboImage(PATH_HTTP_ERROR)
        assertCaptured(PATH_HTTP_ERROR)
    }

    /** AC-21 — the staleness notice shown above a paywall served from an expired cache. */
    @Test
    fun stale_notice_render() = runComposeUiTest {
        setContent {
            DeterministicTheme {
                // Three days, so the humanised age renders its "days ago" branch rather than the
                // minute/hour ones — a fixed value keeps the golden stable.
                StaleConfigNotice(ageSeconds = 3L * 86_400L, onRetry = {})
            }
        }
        onNodeWithTag(PayCraftTestTags.STALE_MESSAGE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.STALE_REFRESH).assertIsDisplayed()
        onRoot().captureRoboImage(PATH_STALE)
        assertCaptured(PATH_STALE)
    }

    /** AC-20 — layer 4: a purchasable surface when nothing else loaded. */
    @Test
    fun builtin_paywall_render() = runComposeUiTest {
        setContent {
            DeterministicTheme {
                BuiltInPaywall(
                    products = listOf(
                        Product.Subscription(
                            id = "p1", sku = "premium_monthly", displayName = "Premium",
                            displayOrder = 0,
                            interval = Product.Subscription.Interval.MONTH,
                            basePrice = Money(amountMinor = 499, currency = "USD"),
                        ),
                        Product.Lifetime(
                            id = "p2", sku = "premium_lifetime", displayName = "Lifetime",
                            displayOrder = 1,
                            basePrice = Money(amountMinor = 9_999, currency = "USD"),
                        ),
                        // A Trial carries no price at all — included so the golden pins that it
                        // renders its duration rather than a fabricated amount.
                        Product.Trial(
                            id = "p3", sku = "premium_trial", displayName = "Free trial",
                            displayOrder = 2, durationDays = 7, attachesToProductId = "p1",
                        ),
                    ),
                    onPickProduct = {},
                    onRetry = {},
                )
            }
        }
        // One tagged button PER product, so this asserts on the collection: the built-in paywall
        // must offer at least one thing to buy, which is the only reason it renders at all.
        onAllNodesWithTag(PayCraftTestTags.PAYWALL_CTA)[0].assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.CONFIG_FAILED_RETRY).assertIsDisplayed()
        onRoot().captureRoboImage(PATH_BUILTIN)
        assertCaptured(PATH_BUILTIN)
    }

    @Composable
    private fun DeterministicTheme(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(
                modifier = Modifier
                    .size(width = 411.dp, height = 891.dp)
                    .background(MaterialTheme.colorScheme.surface),
            ) {
                PayCraftThemeProvider(content = content)
            }
        }
    }

    private fun assertCaptured(relativePath: String) {
        val file = java.io.File(relativePath)
        assertTrue(
            file.exists() && file.length() > 0L,
            "captureRoboImage did not write $relativePath — verifyRoborazziJvm would be vacuously green",
        )
    }

    private companion object {
        const val PATH_UNAVAILABLE = "src/jvmTest/resources/screenshots/config_unavailable_offline.png"
        const val PATH_HTTP_ERROR = "src/jvmTest/resources/screenshots/config_unavailable_http_error.png"
        const val PATH_STALE = "src/jvmTest/resources/screenshots/stale_config_notice.png"
        const val PATH_BUILTIN = "src/jvmTest/resources/screenshots/builtin_paywall.png"
    }
}

/** Kept for symmetry with the sibling harness; unused SuiteConfig/ProductDto imports guard drift. */
@Suppress("unused")
private val unusedTypeAnchor: List<Any> = listOf(SuiteConfig::class, ProductDto::class)
