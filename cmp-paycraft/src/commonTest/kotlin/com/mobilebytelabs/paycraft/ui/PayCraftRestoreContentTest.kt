package com.mobilebytelabs.paycraft.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.core.FakeBillingManager
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
