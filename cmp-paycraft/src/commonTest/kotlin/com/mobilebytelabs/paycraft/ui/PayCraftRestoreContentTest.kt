package com.mobilebytelabs.paycraft.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.SubscriptionActivated
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Compose UI tests for [PayCraftRestoreContent] — the stateless content composable
 * that accepts a [BillingManager] parameter directly, avoiding Koin.
 *
 * [PayCraftRestore] (the outer ModalBottomSheet wrapper) uses [koinInject] and
 * cannot be unit-tested without standing up a full Koin container in a way no
 * other test in this module does; those flows are deferred to the Maestro e2e
 * suite (`maestro/paycraft_restore_flow.yaml`).
 *
 * Uses [runComposeUiTest] (commonTest-friendly) matching the pattern in PaywallTemplateTest.
 */
@OptIn(ExperimentalTestApi::class)
class PayCraftRestoreContentTest {

    // ── Fake BillingManager ───────────────────────────────────────────────────

    /**
     * Minimal in-memory [BillingManager] for Compose UI tests.
     * Starts in [BillingState.Free] and never performs real network calls.
     */
    private class FakeBillingManager(initialState: BillingState = BillingState.Free) : BillingManager {

        private val _billingState = MutableStateFlow<BillingState>(initialState)
        override val billingState: StateFlow<BillingState> = _billingState

        private val _isPremium = MutableStateFlow(initialState is BillingState.Premium)
        override val isPremium: StateFlow<Boolean> = _isPremium

        private val _subscriptionStatus = MutableStateFlow(SubscriptionStatus())
        override val subscriptionStatus: StateFlow<SubscriptionStatus> = _subscriptionStatus

        private val _userEmail = MutableStateFlow<String?>(null)
        override val userEmail: StateFlow<String?> = _userEmail

        private val _subscriptionActivated = MutableSharedFlow<SubscriptionActivated>(replay = 0)
        override val subscriptionActivated: SharedFlow<SubscriptionActivated> = _subscriptionActivated

        private val _isInTrial = MutableStateFlow(false)
        override val isInTrial: StateFlow<Boolean> = _isInTrial

        private val _trialEndsAt = MutableStateFlow<String?>(null)
        override val trialEndsAt: StateFlow<String?> = _trialEndsAt

        var registerAndLoginCallCount = 0
        var lastRegisteredEmail: String? = null

        override fun registerAndLogin(email: String) {
            registerAndLoginCallCount++
            lastRegisteredEmail = email
        }

        override fun logIn(email: String) = registerAndLogin(email)

        override fun purchaseViaPlayBilling(plan: BillingPlan, email: String?) { /* no-op in tests */ }

        override suspend fun checkTrialEligibility(): Boolean = true

        override fun refreshStatus(force: Boolean) { /* no-op in tests */ }

        override suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String) { /* no-op */ }

        override suspend fun verifyOtpOwnership(email: String, otp: String): Boolean = false

        override suspend fun confirmDeviceTransfer() { /* no-op */ }

        override suspend fun requestOtpVerification(email: String) { /* no-op */ }

        override suspend fun verifyOtp(email: String, otp: String): Boolean = false

        override suspend fun transferToDevice() { /* no-op */ }

        override suspend fun revokeCurrentDevice() { /* no-op */ }

        override fun logOut() { /* no-op */ }

        /** Test-only: drive the billing state to simulate a server response. */
        fun emitState(state: BillingState) {
            _billingState.value = state
        }
    }

    // ── Rendering — initial idle state ────────────────────────────────────────

    @Test
    fun restore_content_renders_restore_button() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
            )
        }
        onNodeWithTag("paycraft_restore_button").assertExists()
    }

    @Test
    fun restore_content_renders_email_field() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
            )
        }
        onNodeWithTag("paycraft_restore_email_field").assertExists()
    }

    @Test
    fun restore_content_renders_cancel_button() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
            )
        }
        onNodeWithTag("paycraft_restore_cancel_button").assertExists()
    }

    // ── Restore button state — disabled when email is blank ───────────────────

    @Test
    fun restore_button_disabled_when_email_is_blank() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
            )
        }
        onNodeWithTag("paycraft_restore_button").assertIsNotEnabled()
    }

    @Test
    fun restore_button_enabled_when_email_entered() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
            )
        }
        onNodeWithTag("paycraft_restore_email_field").performTextInput("user@example.com")
        onNodeWithTag("paycraft_restore_button").assertIsEnabled()
    }

    // ── Email validation error messages ───────────────────────────────────────

    @Test
    fun cancel_fires_onCancel_callback() = runComposeUiTest {
        val fake = FakeBillingManager()
        var cancelFired = false
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = { cancelFired = true },
                onSuccess = {},
            )
        }
        onNodeWithTag("paycraft_restore_cancel_button").performClick()
        waitForIdle()
        assertTrue(cancelFired, "onCancel should have been called when Cancel was tapped")
    }

    // ── OAuth buttons appear only when callbacks are provided ─────────────────

    @Test
    fun google_button_hidden_when_no_google_callback() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
                onGoogleSignInClick = null,
            )
        }
        onNodeWithTag("paycraft_restore_google_button").assertDoesNotExist()
    }

    @Test
    fun google_button_shown_when_google_callback_provided() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
                onGoogleSignInClick = { /* test trigger */ },
            )
        }
        onNodeWithTag("paycraft_restore_google_button").assertExists()
    }

    @Test
    fun apple_button_hidden_when_no_apple_callback() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
                onAppleSignInClick = null,
            )
        }
        onNodeWithTag("paycraft_restore_apple_button").assertDoesNotExist()
    }

    @Test
    fun apple_button_shown_when_apple_callback_provided() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
                onAppleSignInClick = { /* test trigger */ },
            )
        }
        onNodeWithTag("paycraft_restore_apple_button").assertExists()
    }

    // ── registerAndLogin wired to restore button ──────────────────────────────

    @Test
    fun tapping_restore_button_with_valid_email_calls_registerAndLogin() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(
                billingManager = fake,
                onCancel = {},
                onSuccess = {},
            )
        }
        onNodeWithTag("paycraft_restore_email_field").performTextInput("hello@test.com")
        onNodeWithTag("paycraft_restore_button").performClick()
        waitForIdle()
        assertEquals(1, fake.registerAndLoginCallCount)
        assertEquals("hello@test.com", fake.lastRegisteredEmail)
    }
}
