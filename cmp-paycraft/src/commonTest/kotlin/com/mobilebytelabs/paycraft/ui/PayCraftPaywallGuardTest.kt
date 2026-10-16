package com.mobilebytelabs.paycraft.ui

import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import kotlin.test.Test

/**
 * The branches of [PayCraftPaywallGuardScreen] — which of content / ads / paywall / loading renders.
 *
 * Entitlement arrives through [LocalPayCraftEntitlementOverride], the same seam the live gates use
 * and the one this guard's own deprecation message points previews at. It used to arrive through a
 * `billingManager` parameter, which was a test seam sitting in public API and the last thing keeping
 * `BillingManager` a public type.
 *
 * What moved out: the three tests that asserted how entitlement is DERIVED (payment-pending, offline
 * grace, a host-pushed ad-free cohort). That derivation is now `gateVerdictOf`, shared with the live
 * gates, and [GateVerdictTest] asserts it directly — cheaper and in one place rather than through
 * whichever composable happened to call it.
 *
 * Two branches here matter most: "premium sees no ads" and "not-premium with no ad slot gets the
 * paywall". Both are ways a guard can silently hand paid content to someone who has not paid, and
 * neither shows up as a crash — only as revenue.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftPaywallGuardTest {

    private val gatedText = "gated-content"
    private val adText = "ad-slot"
    private val paywallText = "sdk-paywall"
    private val loadingText = "resolving"

    @Composable
    private fun Entitled(body: @Composable () -> Unit) =
        CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Entitled) { body() }

    @Composable
    private fun NotEntitled(body: @Composable () -> Unit) =
        CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) { body() }

    @Composable
    private fun Resolving(body: @Composable () -> Unit) =
        CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Resolving) { body() }

    @Test
    fun `a premium user sees the content`() = runComposeUiTest {
        setContent {
            Entitled { PayCraftPaywallGuardScreen(onDismiss = {}) { Text(gatedText) } }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_UNLOCKED).assertIsDisplayed()
        onNodeWithText(gatedText).assertIsDisplayed()
    }

    @Test
    fun `a premium user is never shown ads even with showAds on`() = runComposeUiTest {
        // Ad-free is the thing they paid for. A guard that renders the ad slot for a subscriber
        // because `showAds = true` was passed app-wide is a billing bug the compiler cannot see.
        setContent {
            Entitled {
                PayCraftPaywallGuardScreen(
                    onDismiss = {},
                    showAds = true,
                    ads = { Text(adText) },
                ) { Text(gatedText) }
            }
        }
        onNodeWithText(gatedText).assertIsDisplayed()
        onNodeWithText(adText).assertDoesNotExist()
    }

    @Test
    fun `a free user with an ad slot sees the content plus the ads`() = runComposeUiTest {
        setContent {
            NotEntitled {
                PayCraftPaywallGuardScreen(
                    onDismiss = {},
                    showAds = true,
                    ads = { Text(adText) },
                ) { Text(gatedText) }
            }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_AD_SUPPORTED).assertIsDisplayed()
        onNodeWithText(gatedText).assertIsDisplayed()
        onNodeWithText(adText).assertIsDisplayed()
    }

    @Test
    fun `a free user with no ad slot is gated rather than given the content for free`() = runComposeUiTest {
        // showAds = true but no `ads` slot is a MISCONFIGURATION. It must fail CLOSED: handing over
        // the content because the host forgot to supply an ad slot is the most expensive possible
        // default, and it is the one a naive `if (showAds) content()` produces.
        setContent {
            NotEntitled {
                PayCraftPaywallGuardScreen(
                    onDismiss = {},
                    showAds = true,
                    ads = null,
                    paywall = { Text(paywallText) },
                ) { Text(gatedText) }
            }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_LOCKED).assertIsDisplayed()
        onNodeWithText(gatedText).assertDoesNotExist()
        onNodeWithText(paywallText).assertIsDisplayed()
    }

    @Test
    fun `a free user without ads gets the paywall in place of the content`() = runComposeUiTest {
        setContent {
            NotEntitled {
                PayCraftPaywallGuardScreen(
                    onDismiss = {},
                    paywall = { Text(paywallText) },
                ) { Text(gatedText) }
            }
        }
        onNodeWithText(paywallText).assertIsDisplayed()
        onNodeWithText(gatedText).assertDoesNotExist()
    }

    @Test
    fun `while the entitlement is resolving neither content nor paywall is shown`() = runComposeUiTest {
        // A paywall here would be a claim the SDK cannot yet support, and it flashed at paying
        // customers on every cold start before Loading became its own branch.
        setContent {
            Resolving {
                PayCraftPaywallGuardScreen(
                    onDismiss = {},
                    loading = { Text(loadingText) },
                    paywall = { Text(paywallText) },
                ) { Text(gatedText) }
            }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_RESOLVING).assertIsDisplayed()
        onNodeWithText(loadingText).assertIsDisplayed()
        onNodeWithText(gatedText).assertDoesNotExist()
        onNodeWithText(paywallText).assertDoesNotExist()
    }

    @Test
    fun `resolving with no loading slot renders an empty container rather than the paywall`() = runComposeUiTest {
        // The default. Nothing is drawn, but the guard must still have taken the resolving branch —
        // asserted by EXISTENCE, since an empty container has no size to display.
        setContent {
            Resolving {
                PayCraftPaywallGuardScreen(
                    onDismiss = {},
                    paywall = { Text(paywallText) },
                ) { Text(gatedText) }
            }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_RESOLVING).assertExists()
        onNodeWithText(gatedText).assertDoesNotExist()
        onNodeWithText(paywallText).assertDoesNotExist()
    }
}
