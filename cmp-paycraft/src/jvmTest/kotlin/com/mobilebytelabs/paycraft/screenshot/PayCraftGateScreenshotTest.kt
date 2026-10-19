/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * The three gates, RENDERED.
 *
 * They were RENAMED rather than restructured (PremiumGate/SoftGate/RewardedGate →
 * Gate/TeaseGate/AdGate), so the risk was lower than the surfaces that were rewritten — but
 * "lower" is not "none", and they were the last public composables with no pixels behind them.
 *
 * Entitlement arrives through LocalPayCraftEntitlementOverride, which short-circuits before Koin,
 * so these need no graph. ASSERT BEFORE CAPTURE per PaywallStateMatrixTest: a blank render makes a
 * perfectly stable golden.
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.ui.LocalPayCraftEntitlementOverride
import com.mobilebytelabs.paycraft.ui.PayCraftAdGate
import com.mobilebytelabs.paycraft.ui.PayCraftGate
import com.mobilebytelabs.paycraft.ui.PayCraftGateState
import com.mobilebytelabs.paycraft.ui.PayCraftTeaseGate
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class PayCraftGateScreenshotTest {

    private val gated = "gated-content"

    /**
     * Representative gated content: something that FILLS THE WIDTH, as a card or row does.
     *
     * The first version wrapped a bare `Text`, and the golden showed the "Plus" chip overlapping
     * the words — because `PayCraftTeaseGate` is a Box with the badge at `TopEnd`, so with narrow
     * content the badge has nowhere to go but on top of it. That is real behaviour, not a bug in
     * the gate (the escape is the `badgeAlignment` parameter), but it is not what a consumer sees:
     * these gates wrap cards and rows. A golden of an unrepresentative fixture pins a layout
     * nobody ships.
     */
    @Composable
    private fun GatedCard() {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(96.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            Text(gated, modifier = Modifier.padding(16.dp))
        }
    }

    // ── PayCraftGate — content REPLACED when not entitled ────────────────────────────────────────

    @Test
    fun gate_entitled_renders_the_content() = runComposeUiTest {
        setContent {
            Harness(PayCraftGateState.Entitled) { PayCraftGate { GatedCard() } }
        }
        onNodeWithTag(PayCraftTestTags.GATE_UNLOCKED).assertIsDisplayed()
        onNodeWithText(gated).assertIsDisplayed()
        onRoot().captureRoboImage(P_GATE_ENTITLED)
        assertCaptured(P_GATE_ENTITLED)
    }

    @Test
    fun gate_resolving_shows_neither_content_nor_offer() = runComposeUiTest {
        // "We do not know yet" is not "not premium". A paywall here flashes at paying customers on
        // every cold start — the defect Loading-as-its-own-state exists to prevent.
        setContent {
            Harness(PayCraftGateState.Resolving) {
                PayCraftGate(loading = { Text("resolving") }) { GatedCard() }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_RESOLVING).assertExists()
        onNodeWithText(gated).assertDoesNotExist()
        onRoot().captureRoboImage(P_GATE_RESOLVING)
        assertCaptured(P_GATE_RESOLVING)
    }

    // ── PayCraftTeaseGate — content VISIBLE, tap shielded ────────────────────────────────────────

    @Test
    fun teaseGate_not_entitled_keeps_the_content_readable() = runComposeUiTest {
        // THE distinction from PayCraftGate. If the content is hidden here, the two have collapsed
        // into one and the preset is pointless.
        setContent {
            Harness(PayCraftGateState.NotEntitled) { PayCraftTeaseGate { GatedCard() } }
        }
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_LOCKED).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_SHIELD).assertExists()
        onNodeWithText(gated).assertIsDisplayed()
        onRoot().captureRoboImage(P_TEASE_LOCKED)
        assertCaptured(P_TEASE_LOCKED)
    }

    @Test
    fun teaseGate_entitled_drops_the_shield() = runComposeUiTest {
        setContent {
            Harness(PayCraftGateState.Entitled) { PayCraftTeaseGate { GatedCard() } }
        }
        onNodeWithTag(PayCraftTestTags.GATE_UNLOCKED).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_SOFT_SHIELD).assertDoesNotExist()
        onNodeWithText(gated).assertIsDisplayed()
        onRoot().captureRoboImage(P_TEASE_UNLOCKED)
        assertCaptured(P_TEASE_UNLOCKED)
    }

    // ── PayCraftAdGate — ad OR subscribe ─────────────────────────────────────────────────────────

    @Test
    fun adGate_not_entitled_offers_both_routes() = runComposeUiTest {
        setContent {
            Harness(PayCraftGateState.NotEntitled) {
                PayCraftAdGate(featureKey = "export", ads = { _ -> Text("ad-slot") }) { GatedCard() }
            }
        }
        onNodeWithTag(PayCraftTestTags.GATE_REWARDED_CHOICE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_WATCH_AD_BUTTON).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.GATE_UPGRADE_BUTTON).assertIsDisplayed()
        onNodeWithText(gated).assertDoesNotExist()
        onRoot().captureRoboImage(P_AD_CHOICE)
        assertCaptured(P_AD_CHOICE)
    }

    // NOT GOLDENED, deliberately — the two LOCKED branches render the SDK's own paywall:
    //
    //   PayCraftGate      not-entitled  → PayCraftPaywallComposable in place of the content
    //   PayCraftAdGate    ads = null    → same, since subscribing is the only route left
    //
    // That path resolves Koin and the tenant config, so capturing it here would be testing a
    // harness rather than the gate. It is covered twice already: the paywall itself has 14
    // goldens (PaywallStateMatrixTest and friends), and the BRANCHING — including
    // `rewardedGate_noAdsSupplied_failsClosed` — is asserted in PayCraftGatesTest, which drives
    // the same composables through LocalPayCraftEntitlementOverride without rendering the offer.
    //
    // What IS goldened here is every branch a gate renders ITSELF: entitled, resolving, the tease
    // shield, and the rewarded choice.

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────────

    @Composable
    private fun Harness(state: PayCraftGateState, content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(
                modifier = Modifier
                    .size(width = 411.dp, height = 420.dp)
                    .background(MaterialTheme.colorScheme.surface),
            ) {
                PayCraftThemeProvider {
                    CompositionLocalProvider(LocalPayCraftEntitlementOverride provides state) {
                        Column(modifier = Modifier.fillMaxWidth()) { content() }
                    }
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
        const val P_GATE_ENTITLED = "$DIR/gate_entitled.png"
        const val P_GATE_RESOLVING = "$DIR/gate_resolving.png"
        const val P_TEASE_LOCKED = "$DIR/gate_tease_locked.png"
        const val P_TEASE_UNLOCKED = "$DIR/gate_tease_unlocked.png"
        const val P_AD_CHOICE = "$DIR/gate_ad_choice.png"
    }
}
