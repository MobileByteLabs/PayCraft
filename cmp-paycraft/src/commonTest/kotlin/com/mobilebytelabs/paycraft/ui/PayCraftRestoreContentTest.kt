package com.mobilebytelabs.paycraft.ui

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.ui.components.ProvidePayCraftOAuthHandler
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
    fun restore_content_has_no_email_path() = runComposeUiTest {
        // Restore is Google / Apple sign-in only: a typed address is an unverified claim.
        setContent {
            ProvidePayCraftOAuthHandler(handler = { _: OAuthProvider -> }) {
                PayCraftRestoreContent(billingManager = FakeBillingManager(), onCancel = {}, onSuccess = {})
            }
        }
        onNodeWithTag("paycraft_restore_email_field").assertDoesNotExist()
        onNodeWithTag("paycraft_restore_button").assertDoesNotExist()
        onNodeWithText("Or restore with email").assertDoesNotExist()
    }

    @Test
    fun restore_content_renders_cancel_button() = runComposeUiTest {
        setContent {
            PayCraftRestoreContent(billingManager = FakeBillingManager(), onCancel = {}, onSuccess = {})
        }
        onNodeWithTag("paycraft_restore_cancel_button").assertExists()
    }

    @Test
    fun opening_the_sheet_checks_the_store_first() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent { PayCraftRestoreContent(billingManager = fake, onCancel = {}, onSuccess = {}) }
        waitForIdle()
        assertEquals(1, fake.restoreStorePurchasesCallCount)
    }

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
    fun oauth_buttons_hidden_when_the_host_supplied_no_handler() = runComposeUiTest {
        // No ProvidePayCraftOAuthHandler around this. Showing "Continue with Google" when nothing
        // can run Google sign-in is a dead button on the one screen a user reaches while already
        // frustrated about a purchase they cannot find.
        val fake = FakeBillingManager()
        setContent {
            PayCraftRestoreContent(billingManager = fake, onCancel = {}, onSuccess = {})
        }
        onNodeWithTag("paycraft_restore_google_button").assertDoesNotExist()
        onNodeWithTag("paycraft_restore_apple_button").assertDoesNotExist()
    }

    @Test
    fun oauth_buttons_shown_when_the_host_supplied_a_handler() = runComposeUiTest {
        // One handler produces BOTH buttons. The previous version took two independent nullable
        // callbacks, so a host could supply Google and silently get no Apple button — a state that
        // does not occur in reality, since the SDK asks the handler for a provider.
        val fake = FakeBillingManager()
        setContent {
            ProvidePayCraftOAuthHandler(handler = { _: OAuthProvider -> }) {
                PayCraftRestoreContent(billingManager = fake, onCancel = {}, onSuccess = {})
            }
        }
        onNodeWithTag("paycraft_restore_google_button").assertExists()
        onNodeWithTag("paycraft_restore_apple_button").assertExists()
    }

    @Test
    fun tapping_a_oauth_button_asks_the_host_for_that_provider() = runComposeUiTest {
        val fake = FakeBillingManager()
        val asked = mutableListOf<OAuthProvider>()
        setContent {
            ProvidePayCraftOAuthHandler(handler = { provider -> asked += provider }) {
                PayCraftRestoreContent(billingManager = fake, onCancel = {}, onSuccess = {})
            }
        }
        onNodeWithTag("paycraft_restore_google_button").performClick()
        onNodeWithTag("paycraft_restore_apple_button").performClick()
        assertEquals(listOf(OAuthProvider.GOOGLE, OAuthProvider.APPLE), asked)
    }

    // ── Outcomes after a sign-in ──────────────────────────────────────────────

    @Test
    fun nothing_to_restore_names_the_account_and_re_enables_providers() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            ProvidePayCraftOAuthHandler(handler = { _: OAuthProvider -> }) {
                PayCraftRestoreContent(billingManager = fake, onCancel = {}, onSuccess = {})
            }
        }
        onNodeWithTag("paycraft_restore_google_button").performClick()
        fake.emitEmail("maya@workmail.in")
        fake.emitState(BillingState.Loading)
        waitForIdle()
        onNodeWithTag("paycraft_restore_checking").assertExists()
        fake.emitState(BillingState.Free)
        waitForIdle()
        onNodeWithTag("paycraft_restore_error_message").assertExists()
        onNodeWithText("maya@workmail.in", substring = true).assertExists()
        onNodeWithTag("paycraft_restore_google_button").assertIsEnabled()
        onNodeWithTag("paycraft_restore_apple_button").assertIsEnabled()
        onNodeWithTag("paycraft_restore_retry_button").assertDoesNotExist()
    }

    @Test
    fun try_again_after_a_network_error_re_runs_the_store_restore() = runComposeUiTest {
        val fake = FakeBillingManager()
        setContent {
            ProvidePayCraftOAuthHandler(handler = { _: OAuthProvider -> }) {
                PayCraftRestoreContent(billingManager = fake, onCancel = {}, onSuccess = {})
            }
        }
        waitForIdle()
        assertEquals(1, fake.restoreStorePurchasesCallCount) // the store-first check on open
        onNodeWithTag("paycraft_restore_google_button").performClick()
        fake.emitState(BillingState.Loading)
        waitForIdle()
        fake.emitState(BillingState.Error("timeout"))
        waitForIdle()
        onNodeWithTag("paycraft_restore_network_error").assertExists()
        onNodeWithTag("paycraft_restore_error_message").assertDoesNotExist()

        onNodeWithTag("paycraft_restore_retry_button").performClick()
        waitForIdle()
        assertEquals(2, fake.restoreStorePurchasesCallCount)
        // Still failing (nothing changed server-side in the fake) → the error comes back, retryable.
        onNodeWithTag("paycraft_restore_retry_button").assertExists()
    }

    @Test
    fun an_already_subscribed_email_is_named_with_the_restore_instruction() = runComposeUiTest {
        setContent {
            PayCraftRestoreContent(
                billingManager = FakeBillingManager(),
                onCancel = {},
                onSuccess = {},
                alreadySubscribedEmail = "paid@buyer.test",
            )
        }
        onNodeWithText("You're already subscribed").assertExists()
        onNodeWithText("paid@buyer.test already has an active subscription", substring = true).assertExists()
        onNodeWithText("Restore Purchases").assertDoesNotExist()
    }
}
