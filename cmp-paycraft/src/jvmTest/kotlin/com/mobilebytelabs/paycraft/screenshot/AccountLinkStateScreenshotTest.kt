/*
 * Copyright 2026 Mobile Byte Labs — PayCraft SDK
 *
 * sdk-account-link — one golden per designed state (20, matching idea-layer/mockups/sdk-account-link/
 * stitch/NN-*), each paired with an assertion on the element that defines the state, plus the
 * behaviour of the D6 sign-in wiring (launch / disabled-while-busy / cancel → reset).
 *
 * Sign-in is driven through the injected PayCraftSignIn — no Koin, no network.
 *
 *   ./gradlew :cmp-paycraft:recordRoborazziJvm --tests '*AccountLinkStateScreenshotTest*'
 */
package com.mobilebytelabs.paycraft.screenshot

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.ComposeUiTest
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runDesktopComposeUiTest
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.core.identity.SignInFailure
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.model.VerificationMethod
import com.mobilebytelabs.paycraft.ui.PayCraftLinkAccountScreen
import com.mobilebytelabs.paycraft.ui.PayCraftRestoreContent
import com.mobilebytelabs.paycraft.ui.PayCraftTestTags
import com.mobilebytelabs.paycraft.ui.components.DeviceConflictBody
import com.mobilebytelabs.paycraft.ui.components.OwnershipVerifiedContent
import com.mobilebytelabs.paycraft.ui.components.PayCraftSignIn
import com.mobilebytelabs.paycraft.ui.isPlausibleEmail
import com.mobilebytelabs.paycraft.ui.theme.PayCraftThemeProvider
import io.github.takahirom.roborazzi.captureRoboImage
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalTestApi::class)
class AccountLinkStateScreenshotTest {

    /** A recording sign-in in a fixed D6 state. */
    private class FakeSignIn(val state: SignInState) {
        val launched = mutableListOf<OAuthProvider>()
        var resets = 0
        val handle = PayCraftSignIn(
            launch = { launched += it },
            providers = setOf(OAuthProvider.GOOGLE, OAuthProvider.APPLE),
            state = state,
            reset = { resets++ },
        )
    }

    private val google = OAuthProvider.GOOGLE
    private val apple = OAuthProvider.APPLE
    private val email = "maya.iyer@gmail.com"

    // ── restore sheet ─────────────────────────────────────────────────────────────────────

    private fun ComposeUiTest.restore(
        state: SignInState,
        billing: FakeBillingManager = FakeBillingManager(),
    ): FakeSignIn {
        val fake = FakeSignIn(state)
        setContent {
            Frame { PayCraftRestoreContent(billing, onCancel = {}, onSuccess = {}, signIn = fake.handle) }
        }
        return fake
    }

    @Test fun s01_restore_idle() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        restore(SignInState.Idle)
        onNodeWithTag(TAG_GOOGLE).assertIsEnabled()
        onNodeWithTag(TAG_APPLE).assertIsEnabled()
        onNodeWithTag(TAG_EMAIL).assertIsDisplayed()
        capture("01_restore_idle")
    }

    @Test fun s02_restore_launching() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        restore(SignInState.Launching(google))
        onNodeWithText("Opening Google…").assertIsDisplayed()
        onNodeWithTag(TAG_APPLE).assertIsNotEnabled()
        onNodeWithTag(TAG_EMAIL).assertIsNotEnabled()
        capture("02_restore_launching")
    }

    @Test fun s03_restore_waiting_browser() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        restore(SignInState.WaitingForBrowser(apple))
        onNodeWithText("Finish signing in with Apple").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.SIGN_IN_WAITING_CANCEL).assertIsDisplayed()
        onNodeWithTag(TAG_EMAIL).assertDoesNotExist()
        capture("03_restore_waiting_browser")
    }

    @Test fun s04_restore_verifying() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        restore(SignInState.Verifying(google))
        onNodeWithText("Verifying identity…").assertIsDisplayed()
        onNodeWithTag(TAG_APPLE).assertIsNotEnabled()
        capture("04_restore_verifying")
    }

    @Test fun s05_restore_restoring() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val billing = FakeBillingManager()
        restore(SignInState.Idle, billing)
        submitEmail(email)
        billing.emitState(BillingState.Loading)
        waitForIdle()
        onNodeWithText("Checking…").assertIsDisplayed()
        onNodeWithTag(TAG_EMAIL).assertIsNotEnabled()
        capture("05_restore_restoring")
    }

    @Test fun s06_restore_restored() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val billing = FakeBillingManager()
        mainClock.autoAdvance = false // hold the 1.5 s auto-close
        restore(SignInState.Idle, billing)
        submitEmail(email)
        billing.emitState(BillingState.Loading)
        mainClock.advanceTimeByFrame()
        billing.emitState(premium())
        mainClock.advanceTimeBy(100)
        onNodeWithTag("paycraft_restore_success_message").assertIsDisplayed()
        capture("06_restore_restored")
    }

    @Test fun s07_restore_nothing_to_restore() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val billing = FakeBillingManager()
        restore(SignInState.Idle, billing)
        submitEmail("maya@workmail.in")
        billing.emitState(BillingState.Loading)
        waitForIdle()
        billing.emitState(BillingState.Free)
        waitForIdle()
        onNodeWithText("Not Found").assertIsDisplayed()
        capture("07_restore_nothing_to_restore")
    }

    @Test fun s08_restore_error() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val billing = FakeBillingManager()
        restore(SignInState.Idle, billing)
        submitEmail("maya.iyer@gmail")
        onNodeWithText("Please enter a valid email address").assertIsDisplayed()
        assertEquals(0, billing.registerAndLoginCallCount)
        capture("08_restore_error")
    }

    @Test fun s09_restore_cancelled() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        restore(SignInState.Cancelled(google))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_CANCELLED).assertIsDisplayed()
        onNodeWithTag(TAG_GOOGLE).assertIsEnabled()
        capture("09_restore_cancelled")
    }

    @Test fun s10_restore_failed() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        restore(SignInState.Failed(google, SignInFailure.Rejected))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_FAILED).assertIsDisplayed()
        onNodeWithTag(TAG_GOOGLE).assertIsEnabled()
        capture("10_restore_failed")
    }

    // ── link screen ───────────────────────────────────────────────────────────────────────

    private fun ComposeUiTest.link(state: SignInState): FakeSignIn {
        val fake = FakeSignIn(state)
        setContent { Frame { PayCraftLinkAccountScreen(onDone = {}, signIn = fake.handle, linkedEmail = null) } }
        return fake
    }

    @Test fun s11_link_offer() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        link(SignInState.Idle)
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_APPLE).assertIsEnabled()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE).assertIsEnabled()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_NOT_NOW).assertIsDisplayed()
        capture("11_link_offer")
    }

    @Test fun s12_link_launching() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        link(SignInState.Launching(apple))
        onNodeWithText("Opening Apple…").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE).assertIsNotEnabled()
        capture("12_link_launching")
    }

    @Test fun s13_link_waiting_browser() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        link(SignInState.WaitingForBrowser(apple))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_WAITING).assertIsDisplayed()
        capture("13_link_waiting_browser")
    }

    @Test fun s14_link_verifying() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        link(SignInState.Verifying(apple))
        onNodeWithText("Verifying identity…").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE).assertIsNotEnabled()
        capture("14_link_verifying")
    }

    @Test fun s15_link_linked() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        mainClock.autoAdvance = false
        link(SignInState.Linked(email, apple))
        mainClock.advanceTimeByFrame()
        onNodeWithText("Your subscription is linked to $email.").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_APPLE).assertDoesNotExist()
        capture("15_link_linked")
    }

    @Test fun s16_link_cancelled() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        link(SignInState.Cancelled(apple))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_CANCELLED).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_APPLE).assertIsEnabled()
        capture("16_link_cancelled")
    }

    @Test fun s17_link_failed() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        link(SignInState.Failed(apple, SignInFailure.Network))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_FAILED).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_APPLE).assertIsEnabled()
        capture("17_link_failed")
    }

    // ── device conflict ───────────────────────────────────────────────────────────────────

    private fun conflict() = BillingState.DeviceConflict(
        email = email,
        pendingToken = "tok",
        conflictingDeviceName = "Pixel 8 Pro",
        conflictingLastSeen = "2 days ago",
        supportEmail = "support@cappy.app",
    )

    private fun ComposeUiTest.conflictScreen(state: SignInState): FakeSignIn {
        val fake = FakeSignIn(state)
        setContent { Frame { DeviceConflictBody(conflict(), onAction = {}, signIn = fake.handle) } }
        return fake
    }

    @Test fun s18_conflict() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        conflictScreen(SignInState.Idle)
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_DEVICE_NAME).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_GOOGLE).assertIsEnabled()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_SUPPORT).assertIsDisplayed()
        capture("18_conflict")
    }

    @Test fun s19_conflict_verifying() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        conflictScreen(SignInState.Verifying(google))
        onNodeWithText("Verifying identity…").assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_APPLE).assertIsNotEnabled()
        capture("19_conflict_verifying")
    }

    @Test fun s20_ownership_verified() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        setContent {
            Frame {
                OwnershipVerifiedContent(
                    state = BillingState.OwnershipVerified(
                        email = email,
                        pendingToken = "tok",
                        conflictingDeviceName = "Pixel 8 Pro",
                        conflictingLastSeen = "2 days ago",
                        verifiedVia = VerificationMethod.OAUTH,
                        supportEmail = "support@cappy.app",
                    ),
                    onAction = {},
                )
            }
        }
        onNodeWithTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CONFIRM).assertIsDisplayed()
        onNodeWithTag(PayCraftTestTags.OWNERSHIP_VERIFIED_CANCEL).assertIsDisplayed()
        capture("20_ownership_verified")
    }

    /** Apple's button must invert on a dark theme (white button, black logo). */
    @Test fun s01_restore_idle_dark() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        setContent {
            Frame(dark = true) {
                PayCraftRestoreContent(FakeBillingManager(), onCancel = {
                }, onSuccess = {}, signIn = FakeSignIn(SignInState.Idle).handle)
            }
        }
        onNodeWithTag(TAG_APPLE).assertIsDisplayed()
        capture("01_restore_idle_dark")
    }

    // ── behaviour ────────────────────────────────────────────────────────────────────────

    @Test fun restore_buttons_dispatch_launch_for_their_provider() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = restore(SignInState.Idle)
        onNodeWithTag(TAG_GOOGLE).performClick()
        onNodeWithTag(TAG_APPLE).performClick()
        assertEquals(listOf(google, apple), fake.launched)
    }

    @Test fun link_buttons_dispatch_launch_for_their_provider() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = link(SignInState.Idle)
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_APPLE).performClick()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE).performClick()
        assertEquals(listOf(apple, google), fake.launched)
    }

    @Test fun conflict_buttons_dispatch_launch_for_their_provider() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = conflictScreen(SignInState.Idle)
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_GOOGLE).performClick()
        onNodeWithTag(PayCraftTestTags.DEVICE_CONFLICT_GATE_OAUTH_APPLE).performClick()
        assertEquals(listOf(google, apple), fake.launched)
    }

    @Test fun every_provider_button_is_disabled_while_launching() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = link(SignInState.Launching(apple))
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_APPLE).assertIsNotEnabled()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE).assertIsNotEnabled()
        onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_GOOGLE).performClick()
        assertTrue(fake.launched.isEmpty(), "a busy sign-in must not launch a second one")
    }

    @Test fun every_provider_button_is_disabled_while_verifying() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = restore(SignInState.Verifying(google))
        onNodeWithTag(TAG_GOOGLE).assertIsNotEnabled()
        onNodeWithTag(TAG_APPLE).assertIsNotEnabled()
        onNodeWithTag(TAG_APPLE).performClick()
        assertTrue(fake.launched.isEmpty())
    }

    @Test fun cancel_while_waiting_for_browser_resets_restore() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = restore(SignInState.WaitingForBrowser(apple))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_WAITING_CANCEL).performClick()
        assertEquals(1, fake.resets)
    }

    @Test fun cancel_while_waiting_for_browser_resets_link() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = link(SignInState.WaitingForBrowser(google))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_WAITING_CANCEL).performClick()
        assertEquals(1, fake.resets)
    }

    @Test fun cancel_while_waiting_for_browser_resets_conflict() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = conflictScreen(SignInState.WaitingForBrowser(google))
        onNodeWithTag(PayCraftTestTags.SIGN_IN_WAITING_CANCEL).performClick()
        assertEquals(1, fake.resets)
    }

    @Test fun a_stale_terminal_state_is_cleared_on_entry() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = link(SignInState.Failed(google, SignInFailure.Network))
        waitForIdle()
        assertEquals(1, fake.resets)
    }

    @Test fun an_attempt_in_flight_is_not_cleared_on_entry() = runDesktopComposeUiTest(WIDTH, HEIGHT) {
        val fake = link(SignInState.Verifying(google))
        waitForIdle()
        assertEquals(0, fake.resets)
    }

    @Test fun email_check_requires_a_dot_after_the_at() {
        assertTrue(isPlausibleEmail("maya.iyer@gmail.com"))
        assertFalse(isPlausibleEmail("maya.iyer@gmail"))
        assertFalse(isPlausibleEmail("@gmail.com"))
        assertFalse(isPlausibleEmail("maya@gmail."))
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    private fun ComposeUiTest.submitEmail(value: String) {
        onNodeWithTag(TAG_EMAIL).performTextInput(value)
        onNodeWithTag(TAG_RESTORE).performClick()
    }

    private fun premium() = BillingState.Premium(SubscriptionStatus(isPremium = true, plan = "annual", email = email))

    private fun ComposeUiTest.capture(name: String) {
        val path = "$DIR/account_link_$name.png"
        onRoot().captureRoboImage(path)
        assertTrue(java.io.File(path).let { it.exists() && it.length() > 0L }, "no golden written at $path")
    }

    @Composable
    private fun Frame(dark: Boolean = false, content: @Composable () -> Unit) {
        MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(MaterialTheme.colorScheme.surface),
            ) { PayCraftThemeProvider(content = content) }
        }
    }

    private companion object {
        const val DIR = "src/jvmTest/resources/screenshots"

        // A phone-sized window: the desktop default (1024x768) clips the restore sheet's tail.
        const val WIDTH = 411
        const val HEIGHT = 900
        const val TAG_GOOGLE = "paycraft_restore_google_button"
        const val TAG_APPLE = "paycraft_restore_apple_button"
        const val TAG_EMAIL = "paycraft_restore_email_field"
        const val TAG_RESTORE = "paycraft_restore_button"
    }
}
