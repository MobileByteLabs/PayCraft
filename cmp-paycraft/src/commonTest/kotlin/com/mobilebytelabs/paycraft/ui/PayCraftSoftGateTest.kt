package com.mobilebytelabs.paycraft.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.koin.compose.KoinApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.koin.dsl.module

/**
 * [PayCraftSoftGate] — the soft posture: content stays visible, only the ACTION is redirected.
 *
 * The decisive test is [softGate_locked_absorbsTheTap_soTheHostActionNeverFires]. A badge-only helper
 * passes every other assertion here and still lets premium audio play, because the host's own
 * clickable is untouched. That is the defect this gate exists to prevent, so it is asserted by
 * COUNTING host-action invocations rather than by looking at pixels.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftSoftGateTest {

    private val item = "premium-soundscape"

    // The upsell sheet's ViewModel uses viewModelScope.
    @BeforeTest fun setUp() { Dispatchers.setMain(UnconfinedTestDispatcher()) }
    @AfterTest fun tearDown() { Dispatchers.resetMain() }

    /** Stand-in for a host tile whose whole surface is one clickable (cappy's SoundscapeTileCard). */
    @androidx.compose.runtime.Composable
    private fun HostTile(onPlay: () -> Unit) {
        Box(
            modifier = Modifier
                .size(160.dp)
                .testTag("host_tile")
                .clickable { onPlay() },
        ) { Text(item) }
    }

    @Test
    fun softGate_entitled_rendersContentWithNoChipAndNoShield() = runComposeUiTest {
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Entitled) {
                PayCraftSoftGate { HostTile(onPlay = {}) }
            }
        }
        onNodeWithText(item).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_PLUS_CHIP).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_SHIELD).assertDoesNotExist()
    }

    @Test
    fun softGate_entitled_letsTheHostActionThrough() = runComposeUiTest {
        var plays = 0
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Entitled) {
                PayCraftSoftGate { HostTile(onPlay = { plays++ }) }
            }
        }
        onNodeWithTag("host_tile").performClick()
        assertEquals(1, plays, "a subscriber's tap must reach the feature")
    }

    @Test
    fun softGate_locked_stillShowsTheContent() = runComposeUiTest {
        // THE soft contract, and the difference from PayCraftPremiumGate: a free player must still see
        // what Plus unlocks. Hiding it here would be the hard wall this gate exists to avoid.
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftSoftGate { HostTile(onPlay = {}) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_LOCKED).assertIsDisplayed()
        onNodeWithText(item).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_PLUS_CHIP).assertIsDisplayed()
    }

    @Test
    fun softGate_locked_absorbsTheTap_soTheHostActionNeverFires() = runComposeUiTest {
        // A decorate-only gate would pass every other test in this file and still play premium audio.
        // Counting host invocations is the only assertion that can tell the two apart.
        var plays = 0
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftSoftGate { HostTile(onPlay = { plays++ }) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_SHIELD).performClick()
        assertEquals(0, plays, "the shield must absorb the tap — the gated action may not run")
    }

    @Test
    fun softGate_lockedTap_signalsTheUpsell_notJustAbsorbsIt() = runComposeUiTest {
        // The defect this covers: the first shield only absorbed the tap. It called
        // PayCraft.presentPaywall(), which flips a flow the HOST must observe and render — and cappy,
        // the first consumer, never reads that flow. So the tap went nowhere: strictly worse than the
        // chip-plus-navigation it replaced, and invisible to every other test here, because "the host
        // action did not fire" was satisfied perfectly.
        //
        // SCOPE, stated honestly: this asserts the gate SIGNALS the upsell. The gate also renders
        // PayCraftPaywallSheet itself (that is the actual fix), but asserting the rendered sheet needs
        // a GLOBAL Koin context — Material3 puts sheet content in a separate window layer that does
        // not inherit composition locals, so a KoinApplication {} graph is invisible to it. Starting
        // global Koin here broke InitializeTest and SuiteConfigFlowOrderingTest in the same JVM, which
        // is a worse trade than a narrower assertion. The render half is verified on-device.
        PayCraft.dismissPaywall()
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftSoftGate { HostTile(onPlay = {}) }
            }
        }

        onNodeWithTag(PayCraftTestTags.GATE_SOFT_SHIELD).performClick()

        val presentation = PayCraft.paywallPresentation.value
        assertTrue(
            presentation is PaywallPresentation.Shown,
            "the shield must request the upsell, not swallow the tap (was $presentation)",
        )
        PayCraft.dismissPaywall()
    }

    @Test
    fun softGate_disabled_isCompletelyInert() = runComposeUiTest {
        // `enabled = false` is how a host marks a FREE item in a mixed list. Not entitled, but this
        // item is not Plus-only, so nothing may be added and the tap must work.
        var plays = 0
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftSoftGate(enabled = false) { HostTile(onPlay = { plays++ }) }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_PLUS_CHIP).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_SHIELD).assertDoesNotExist()
        onNodeWithTag("host_tile").performClick()
        assertEquals(1, plays, "a free item in a mixed list must behave as if ungated")
    }

    @Test
    fun softGate_customBadgeReplacesTheDefaultChip() = runComposeUiTest {
        // Hosts with their own Plus chip art keep it; only the plumbing moves to the SDK.
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.NotEntitled) {
                PayCraftSoftGate(badge = { Text("Cappy Plus") }) { HostTile(onPlay = {}) }
            }
        }
        onNodeWithText("Cappy Plus").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_PLUS_CHIP).assertDoesNotExist()
    }

    @Test
    fun softGate_whileResolving_errsOPEN_notLocked() = runComposeUiTest {
        // Deliberately the OPPOSITE of PayCraftPremiumGate. A soft gate must never be the thing that
        // interrupts: flashing a lock at a subscriber during a cold start is the same disappearing-
        // state defect as flashing a paywall, and here the stake is one tap, not the whole screen.
        //
        // Driven through the tri-state override rather than a Koin graph. The earlier Koin version was
        // intermittently red depending on whether another test in this JVM had already started a
        // global Koin context — a failure that said nothing about the gate.
        var plays = 0
        setContent {
            CompositionLocalProvider(LocalPayCraftEntitlementOverride provides PayCraftGateState.Resolving) {
                PayCraftSoftGate { HostTile(onPlay = { plays++ }) }
            }
        }

        onNodeWithTag(PayCraftTestTags.GATE_UNLOCKED).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_SHIELD).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.GATE_PLUS_CHIP).assertDoesNotExist()

        onNodeWithTag("host_tile").performClick()
        assertEquals(1, plays, "while the verdict is unknown a SOFT gate must not block the tap")
    }
}
