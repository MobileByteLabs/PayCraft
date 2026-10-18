package com.mobilebytelabs.paycraft.ui

import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.core.PayCraftAdUnlock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.koin.compose.KoinApplication
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.module
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * [PayCraftGate] + [PayCraftAdGate].
 *
 * Entitlement is driven through [LocalPayCraftEntitlementOverride] — the same seam a consumer's
 * `@Preview` uses — because the gates deliberately take no `billingManager`. That is the point of the
 * API: a consumer never names billing to gate a feature, so a test should not have to either.
 *
 * The cases that matter are the ones that leak paid content: an unentitled user reaching [content]
 * without watching anything, and a reward granted on ad START rather than completion.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftGatesTest {

    private val gated = "gated-content"
    private val adSurface = "ad-surface"
    private val feature = "deep-insights"

    /**
     * Minimal Koin graph for the LOCKED branch.
     *
     * The gates present the SDK's own paywall when not entitled, and that pulls
     * [PayCraftPaywallViewModel] from DI. Without a graph the composition THROWS, and then
     * "gated content is absent" passes for the wrong reason — an empty tree satisfies it trivially.
     * PayCraftPaywallViewModel needs only a BillingManager, so two bindings make the branch real.
     */
    @Composable
    private fun WithPaywallGraph(entitled: Boolean, body: @Composable () -> Unit) {
        KoinApplication(application = {
            modules(
                module {
                    single<BillingManager> { FakeBillingManager(premium = entitled) }
                    viewModelOf(::PayCraftPaywallViewModel)
                },
            )
        }) {
            CompositionLocalProvider(
                LocalPayCraftEntitlementOverride provides
                    if (entitled) PayCraftGateState.Entitled else PayCraftGateState.NotEntitled,
            ) { body() }
        }
    }

    // The SDK paywall's ViewModel uses viewModelScope, so the LOCKED branch needs a Main
    // dispatcher. Without it the paywall subtree throws and every "content is hidden" assertion
    // passes for the wrong reason.
    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        PayCraftAdUnlock.resetForTest()
    }

    @AfterTest
    fun tearDown() {
        PayCraftAdUnlock.resetForTest()
        Dispatchers.resetMain()
    }

    // ── PayCraftGate ──────────────────────────────────────────────────────────────────────

    @Test
    fun premiumGate_entitled_showsContent() = runComposeUiTest {
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Entitled) {
                PayCraftGate { Text(gated) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_UNLOCKED).assertIsDisplayed()
        onNodeWithText(gated).assertIsDisplayed()
    }

    @Test
    fun premiumGate_notEntitled_hidesContent() = runComposeUiTest {
        // The gate's locked branch presents the SDK paywall, which needs a Koin graph for its
        // ViewModel — so this asserts the thing that matters and is assertable without one: the
        // gated content is NOT rendered.
        setContent {
            WithPaywallGraph(entitled = false) { PayCraftGate { Text(gated) } }
        }
        onNodeWithTag(PayCraftTestTags.GATE_LOCKED).assertExists()
        onNodeWithText(gated).assertDoesNotExist()
    }

    // ── PayCraftAdGate ─────────────────────────────────────────────────────────────────────

    @Test
    fun rewardedGate_entitled_showsContentAndNeverOffersAnAd() = runComposeUiTest {
        // A subscriber must never be asked to watch an ad for something they already pay for.
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Entitled) {
                PayCraftAdGate(
                    featureKey = feature,
                    ads = { Text(adSurface) },
                ) { Text(gated) }
            }
        }
        onNodeWithText(gated).assertIsDisplayed()
        onNodeWithText(adSurface).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.GATE_REWARDED_CHOICE).assertDoesNotExist()
    }

    @Test
    fun rewardedGate_notEntitled_offersWatchOrUpgrade_andHidesContent() = runComposeUiTest {
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftAdGate(
                    featureKey = feature,
                    ads = { Text(adSurface) },
                ) { Text(gated) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_REWARDED_CHOICE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_WATCH_AD_BUTTON).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_UPGRADE_BUTTON).assertIsDisplayed()
        onNodeWithText(gated).assertDoesNotExist()
    }

    @Test
    fun rewardedGate_showingTheAdDoesNotUnlock_onlyTheRewardDoes() = runComposeUiTest {
        // THE failure mode of a rewarded gate: unlocking when the ad is PRESENTED means anyone who
        // opens and dismisses it gets the feature. The grant must come from the host's completion
        // callback, which this ad surface never invokes.
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftAdGate(
                    featureKey = feature,
                    ads = { Text(adSurface) }, // never calls onRewardEarned
                ) { Text(gated) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_WATCH_AD_BUTTON).performClick()

        onNodeWithText(adSurface).assertIsDisplayed()
        onNodeWithText(gated).assertDoesNotExist()
        assertFalse(PayCraftAdUnlock.isUnlocked(feature), "no reward was earned, so nothing may be granted")
    }

    @Test
    fun rewardedGate_rewardEarned_unlocksTheContent() = runComposeUiTest {
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftAdGate(
                    featureKey = feature,
                    // A real rewarded ad reports completion as an EVENT. Invoking the callback
                    // inline during composition would be a side effect in composition — bad practice,
                    // and it does not reliably propagate.
                    ads = { onRewardEarned ->
                        Button(onClick = onRewardEarned) { Text(adSurface) }
                    },
                ) { Text(gated) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_WATCH_AD_BUTTON).performClick()
        onNodeWithText(adSurface).performClick() // the host reports the reward

        assertTrue(PayCraftAdUnlock.isUnlocked(feature))
        onNodeWithText(gated).assertIsDisplayed()
    }

    @Test
    fun rewardedGate_noAdsSupplied_failsClosed() = runComposeUiTest {
        // `ads = null` means the host has no inventory. It must behave like PayCraftGate, NOT
        // hand over the content — a gate that opens because the host forgot to wire an ad SDK is the
        // one failure here that costs money.
        setContent {
            WithPaywallGraph(entitled = false) {
                PayCraftAdGate(featureKey = feature, ads = null) { Text(gated) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_LOCKED).assertExists()
        onNodeWithText(gated).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.GATE_REWARDED_CHOICE).assertDoesNotExist()
    }

    @Test
    fun rewardedGate_existingGrantShowsContentWithoutAnyPrompt() = runComposeUiTest {
        PayCraftAdUnlock.grant(feature)
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftAdGate(
                    featureKey = feature,
                    ads = { Text(adSurface) },
                ) { Text(gated) }
            }
        }
        onNodeWithText(gated).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_REWARDED_CHOICE).assertDoesNotExist()
    }

    @Test
    fun rewardedGate_grantsAreScopedPerFeature() = runComposeUiTest {
        // Unlocking insights must not unlock soundscapes.
        PayCraftAdUnlock.grant("insights")
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftAdGate(
                    featureKey = "soundscapes",
                    ads = { Text(adSurface) },
                ) { Text(gated) }
            }
        }
        onNodeWithText(gated).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.GATE_REWARDED_CHOICE).assertIsDisplayed()
    }
}
