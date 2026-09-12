/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * AC-28 — the paywall state matrix: every state captured as a golden AND paired with a NAMED
 * semantic assertion.
 *
 * WHY BOTH, AND WHY THEY LIVE IN THE SAME TEST
 * A golden alone proves a bitmap was written; it cannot say the bitmap contains the thing that
 * defines the state. A blank render produces a perfectly stable golden that passes forever. So each
 * state asserts on a tag that only exists if the state rendered its defining content — the
 * conflicting device NAME for DeviceConflict, the retry for empty-products, the restore button for
 * premium — and the assertion runs BEFORE the capture, so a broken surface fails rather than
 * silently pinning a broken frame as the reference.
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
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.runComposeUiTest
import androidx.compose.ui.unit.dp
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.model.VerificationMethod
import com.mobilebytelabs.paycraft.presentation.templates.DarkTemplate
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.components.DeviceConflictContent
import com.mobilebytelabs.paycraft.ui.components.EmptyProductsContent
import com.mobilebytelabs.paycraft.ui.components.OwnershipVerifiedContent
import com.mobilebytelabs.paycraft.ui.components.PremiumEntitlementActions
import com.mobilebytelabs.paycraft.ui.components.ProvidePayCraftOAuthHandler
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class PaywallStateMatrixTest {

    private fun conflict() = BillingState.DeviceConflict(
        email = "buyer@example.com",
        pendingToken = "tok",
        conflictingDeviceName = "Pixel 8 Pro",
        conflictingLastSeen = "2026-09-01",
        supportEmail = "support@example.com",
    )

    /** AC-25 — the conflicting device is NAMED and all reachable gates are present. */
    @Test
    fun device_conflict_render() = runComposeUiTest {
        setContent {
            DeterministicTheme {
                // A host handler is provided, so the OAuth gate renders. Without one it is
                // deliberately absent rather than dead — covered by the sibling test below.
                ProvidePayCraftOAuthHandler(handler = { _: OAuthProvider -> }) {
                    // A real used-count is supplied here, which is the only case where the
                    // remaining-codes line should appear at all.
                    DeviceConflictContent(state = conflict(), onAction = {})
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_DEVICE_NAME).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_EMAIL).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_GOOGLE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_SUPPORT).assertIsDisplayed()
        onRoot().captureRoboImage(P_DEVICE_CONFLICT)
        assertCaptured(P_DEVICE_CONFLICT)
    }

    /**
     * The OAuth gate must be ABSENT, not disabled, when no host handler exists — a button that
     * cannot complete its action is a dead clickable. Support stays reachable regardless.
     */
    @Test
    fun device_conflict_without_oauth_handler_omits_that_gate() = runComposeUiTest {
        setContent { DeterministicTheme { DeviceConflictContent(state = conflict(), onAction = {}) } }
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_GOOGLE).assertDoesNotExist()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_SUPPORT).assertIsDisplayed()
    }

    /** Support remains reachable for anyone OAuth cannot serve — the only gate that always is. */
    @Test
    fun device_conflict_keeps_support_reachable() = runComposeUiTest {
        setContent {
            DeterministicTheme { DeviceConflictContent(state = conflict(), onAction = {}) }
        }
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_SUPPORT).assertIsDisplayed()
    }

    /** AC-25 — the transfer confirmation, with both exits present. */
    @Test
    fun ownership_verified_render() = runComposeUiTest {
        setContent {
            DeterministicTheme {
                OwnershipVerifiedContent(
                    state = BillingState.OwnershipVerified(
                        email = "buyer@example.com",
                        pendingToken = "tok",
                        conflictingDeviceName = "Pixel 8 Pro",
                        conflictingLastSeen = "2026-09-01",
                        verifiedVia = VerificationMethod.OAUTH,
                        supportEmail = "support@example.com",
                    ),
                    onAction = {},
                )
            }
        }
        onNodeWithTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CONFIRM).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CANCEL).assertIsDisplayed()
        onRoot().captureRoboImage(P_OWNERSHIP)
        assertCaptured(P_OWNERSHIP)
    }

    /** AC-26 — an explanation and a reachable retry, replacing a bare disabled button. */
    @Test
    fun empty_products_render() = runComposeUiTest {
        setContent { DeterministicTheme { EmptyProductsContent(onAction = {}) } }
        onNodeWithTag(PayCraftTestTags.EMPTY_PRODUCTS_MESSAGE).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.EMPTY_PRODUCTS_RETRY).assertIsDisplayed()
        onRoot().captureRoboImage(P_EMPTY)
        assertCaptured(P_EMPTY)
    }

    /** AC-27 — both entitlement operations reachable from the premium arm. */
    @Test
    fun premium_entitlement_actions_render() = runComposeUiTest {
        setContent { DeterministicTheme { PremiumEntitlementActions(onAction = {}) } }
        onNodeWithTag(PayCraftTestTags.PAYWALL_RESTORE_BUTTON).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.MANAGE_SUBSCRIPTION_BUTTON).assertIsDisplayed()
        onRoot().captureRoboImage(P_PREMIUM_ACTIONS)
        assertCaptured(P_PREMIUM_ACTIONS)
    }

    /** AC-27 — the actions dispatch the actions they claim to. */
    @Test
    fun premium_actions_dispatch_their_actions() = runComposeUiTest {
        val dispatched = mutableListOf<Any>()
        setContent { DeterministicTheme { PremiumEntitlementActions(onAction = { dispatched += it }) } }
        onNodeWithTag(PayCraftTestTags.PAYWALL_RESTORE_BUTTON).performClick()
        onNodeWithTag(PayCraftTestTags.MANAGE_SUBSCRIPTION_BUTTON).performClick()
        assertTrue(
            dispatched.any { it.toString().contains("OpenRestoreSheet") },
            "restore button did not dispatch OpenRestoreSheet — got $dispatched",
        )
        assertTrue(
            dispatched.any { it.toString().contains("ManageSubscription") },
            "manage button did not dispatch ManageSubscription — got $dispatched",
        )
    }


    /**
     * DarkTemplate rendering DeviceConflict through the FULL template stack.
     *
     * Every other golden here captures a component in isolation under a fixed lightColorScheme,
     * which is exactly why a dark-mode regression could not be seen: the shared composables read
     * ambient `MaterialTheme.colorScheme`, and in isolation that ambient scheme is the test's, not
     * the template's. Rendering through `DarkTemplate` is the only way this class of defect shows up.
     */
    @Test
    fun dark_template_device_conflict_render() = runComposeUiTest {
        setContent {
            // Deliberately a LIGHT host scheme — the case that was broken. The template must impose
            // its own dark scheme regardless of what the host app is running.
            MaterialTheme(colorScheme = lightColorScheme()) {
                Box(modifier = Modifier.size(width = 411.dp, height = 891.dp)) {
                    PayCraftThemeProvider {
                        DarkTemplate(
                            state = conflict(),
                            products = emptyList(),
                            onPick = {},
                            onRetry = {},
                            onAction = {},
                        )
                    }
                }
            }
        }
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_DEVICE_NAME).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_SUPPORT).assertIsDisplayed()
        onRoot().captureRoboImage(P_DARK_CONFLICT)
        assertCaptured(P_DARK_CONFLICT)
    }

    @Suppress("unused")
    private fun unusedStatusAnchor(): SubscriptionStatus? = null

    @Composable
    private fun DeterministicTheme(content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = lightColorScheme()) {
            Box(
                modifier = Modifier
                    .size(width = 411.dp, height = 891.dp)
                    .background(MaterialTheme.colorScheme.surface),
            ) { PayCraftThemeProvider(content = content) }
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
        const val P_DEVICE_CONFLICT = "$DIR/paywall_device_conflict.png"
        const val P_OWNERSHIP = "$DIR/paywall_ownership_verified.png"
        const val P_EMPTY = "$DIR/paywall_empty_products.png"
        const val P_PREMIUM_ACTIONS = "$DIR/paywall_premium_actions.png"
        const val P_DARK_CONFLICT = "$DIR/paywall_dark_device_conflict.png"
    }
}
