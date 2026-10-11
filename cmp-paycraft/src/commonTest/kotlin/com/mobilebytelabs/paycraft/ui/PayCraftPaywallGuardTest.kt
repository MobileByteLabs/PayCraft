package com.mobilebytelabs.paycraft.ui

import androidx.compose.material3.Text
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.core.AdFreeEntitlement
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlin.test.Test

/**
 * The four branches of [PayCraftPaywallGuardScreen].
 *
 * Two of them are the ones that matter: "premium sees no ads" and "not-premium with no ad slot gets
 * the paywall". Both are ways a gate can silently hand paid content to someone who has not paid, and
 * neither shows up as a crash — only as revenue.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftPaywallGuardTest {

    private val gatedText = "gated-content"
    private val adText = "ad-slot"
    private val paywallText = "sdk-paywall"
    private val loadingText = "resolving"

    @Test
    fun `a premium user sees the content`() = runComposeUiTest {
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                billingManager = FakeBillingManager(premium = true),
            ) { Text(gatedText) }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_UNLOCKED).assertIsDisplayed()
        onNodeWithText(gatedText).assertIsDisplayed()
    }

    @Test
    fun `a premium user is never shown ads, even with showAds on`() = runComposeUiTest {
        // Ad-free is the thing they paid for. A guard that renders the ad slot for a subscriber
        // because `showAds = true` was passed app-wide is a billing bug the compiler cannot see.
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                showAds = true,
                ads = { Text(adText) },
                billingManager = FakeBillingManager(premium = true),
            ) { Text(gatedText) }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_UNLOCKED).assertIsDisplayed()
        onNodeWithText(gatedText).assertIsDisplayed()
        onNodeWithText(adText).assertDoesNotExist()
    }

    @Test
    fun `a free user with an ad slot sees the content plus the ads`() = runComposeUiTest {
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                showAds = true,
                ads = { Text(adText) },
                billingManager = FakeBillingManager(premium = false, billingState = BillingState.Free),
            ) { Text(gatedText) }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_AD_SUPPORTED).assertIsDisplayed()
        onNodeWithText(gatedText).assertIsDisplayed()
        onNodeWithText(adText).assertIsDisplayed()
    }

    @Test
    fun `a host-pushed ad-free cohort gets the content with no ads and no paywall`() = runComposeUiTest {
        // AdFreeEntitlement / PayCraft.isAdFree (AC-12) is the SDK's OWN ad-gating flow — the one a
        // host is told to gate its ads with. A promo or grandfathered cohort can be ad-free WITHOUT
        // being premium, and this guard must agree with that rather than carry its own idea of
        // ad-free: showing ads to someone just granted ad-free, or charging at them, both contradict
        // the grant.
        try {
            AdFreeEntitlement.set(true)
            setContent {
                PayCraftPaywallGuardScreen(
                    onDismiss = {},
                    showAds = true,
                    ads = { Text(adText) },
                    billingManager = FakeBillingManager(premium = false, billingState = BillingState.Free),
                    paywall = { Text(paywallText) },
                ) { Text(gatedText) }
            }
            onNodeWithText(gatedText).assertIsDisplayed()
            onNodeWithText(adText).assertDoesNotExist()
            onNodeWithText(paywallText).assertDoesNotExist()
        } finally {
            AdFreeEntitlement.resetForTest()
        }
    }

    @Test
    fun `a free user with no ad slot is gated, never given the content for free`() = runComposeUiTest {
        // showAds = true but no `ads` slot is a MISCONFIGURATION. It must fail CLOSED: handing over
        // the gated content because the host forgot to pass an ad composable would be the worst
        // possible default, and it is the one a naive `if (showAds) content()` produces.
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                showAds = true,
                ads = null,
                billingManager = FakeBillingManager(premium = false, billingState = BillingState.Free),
                paywall = { Text(paywallText) },
            ) { Text(gatedText) }
        }
        onNodeWithText(gatedText).assertDoesNotExist()
        onNodeWithText(paywallText).assertIsDisplayed()
    }

    @Test
    fun `a free user without ads gets the paywall in place of the content`() = runComposeUiTest {
        // `paywall` is supplied so this asserts the guard's ROUTING without standing up a Koin graph
        // for the real paywall's ViewModel. The default (null) branch renders
        // PayCraftPaywallComposable, which is covered by the paywall's own tests.
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                billingManager = FakeBillingManager(premium = false, billingState = BillingState.Free),
                paywall = { Text(paywallText) },
            ) { Text(gatedText) }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_LOCKED).assertIsDisplayed()
        onNodeWithText(paywallText).assertIsDisplayed()
        onNodeWithText(gatedText).assertDoesNotExist()
    }

    @Test
    fun `while the entitlement is resolving, neither content nor paywall is shown`() = runComposeUiTest {
        // The regression this exists to stop: a paying customer seeing a paywall flash on every cold
        // start because Loading was folded into the not-premium branch.
        //
        // A `loading` slot is supplied so the branch is provable by what RENDERS. The default slot is
        // empty, which makes the container zero-size — and a zero-size node is `assertExists` but not
        // `assertIsDisplayed`, so asserting display against the default would fail for a reason that
        // has nothing to do with the gate.
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                billingManager = FakeBillingManager(premium = false, billingState = BillingState.Loading),
                loading = { Text(loadingText) },
                paywall = { Text(paywallText) },
            ) { Text(gatedText) }
        }
        onNodeWithText(loadingText).assertIsDisplayed()
        onNodeWithText(gatedText).assertDoesNotExist()
        onNodeWithText(paywallText).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_LOCKED).assertDoesNotExist()
    }

    @Test
    fun `resolving with no loading slot renders an empty container, not the paywall`() = runComposeUiTest {
        // The default. Nothing is drawn, but the gate must still have taken the resolving branch —
        // asserted by existence, since an empty container has no size to display.
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                billingManager = FakeBillingManager(premium = false, billingState = BillingState.Loading),
                paywall = { Text(paywallText) },
            ) { Text(gatedText) }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_RESOLVING).assertExists()
        onNodeWithText(gatedText).assertDoesNotExist()
        onNodeWithText(paywallText).assertDoesNotExist()
    }

    @Test
    fun `a buyer whose payment has not cleared keeps access`() = runComposeUiTest {
        // PaymentPending is NOT a BillingState.Premium instance, so a guard that pattern-matches on
        // billingState locks out someone the store has already taken money from. Gating on
        // isPremium — the SDK's one authoritative signal — is what keeps this guard in agreement
        // with the rest of the app.
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                billingManager = FakeBillingManager(
                    premium = true,
                    billingState = BillingState.PaymentPending(productId = "annual"),
                ),
            ) { Text(gatedText) }
        }
        onNodeWithTag(PayCraftTestTags.PAYWALL_GUARD_UNLOCKED).assertIsDisplayed()
        onNodeWithText(gatedText).assertIsDisplayed()
    }

    @Test
    fun `an offline premium user in grace keeps access`() = runComposeUiTest {
        setContent {
            PayCraftPaywallGuardScreen(
                onDismiss = {},
                billingManager = FakeBillingManager(
                    premium = true,
                    billingState = BillingState.Premium(SubscriptionStatus(isPremium = true)),
                ),
            ) { Text(gatedText) }
        }
        onNodeWithText(gatedText).assertIsDisplayed()
    }
}
