package com.mobilebytelabs.paycraft.ui

import androidx.compose.material3.Text
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.runComposeUiTest
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.FakeBillingManager
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.koin.compose.KoinApplication
import org.koin.dsl.module
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * PLAN-paycraft-native-identity D4: after a STORE purchase made without an identity, offer — once,
 * optionally — to link the subscription to an account so it restores on the other platform.
 */
@OptIn(ExperimentalTestApi::class)
class PostPurchaseLinkGateTest {

    private class MemoryStore : PayCraftStore {
        var shown = false
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = null
        override suspend fun clearEmail() = Unit
        override fun isLinkPromptShown() = shown
        override fun markLinkPromptShown() {
            shown = true
        }
    }

    @BeforeTest
    fun setUp() {
        // Another test CLASS may have left its own global Koin graph running — start clean.
        org.koin.core.context.stopKoin()
        Dispatchers.setMain(UnconfinedTestDispatcher())
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
        // KoinApplication registers a GLOBAL context; without this the next test's gate injects the
        // PREVIOUS test's fake and never sees its own emissions (passes alone, fails in the suite).
        org.koin.core.context.stopKoin()
    }

    private fun gate(billing: FakeBillingManager, store: MemoryStore, onFinished: () -> Unit) =
        @androidx.compose.runtime.Composable {
            KoinApplication(application = {
                modules(
                    module {
                        single<BillingManager> { billing }
                        single<PayCraftStore> { store }
                    },
                )
            }) { PostPurchaseLinkGate(onFinished = onFinished) { Text("PAYWALL") } }
        }

    @Test
    fun an_anonymous_store_purchase_offers_linking_once_and_not_now_finishes() {
        val billing = FakeBillingManager()
        val store = MemoryStore()
        runComposeUiTest {
            // The callback runs on the UI thread, the assertion on the test thread: a plain var
            // is not guaranteed visible across them, a StateFlow is.
            val finished = kotlinx.coroutines.flow.MutableStateFlow(0)
            setContent {
                KoinApplication(application = {
                    modules(
                        module {
                            single<BillingManager> { billing }
                            single<PayCraftStore> { store }
                        },
                    )
                }) { PostPurchaseLinkGate(onFinished = { finished.value++ }) { Text("PAYWALL") } }
            }
            billing.emitPremium(true) // the store purchase completed; no email
            waitForIdle()

            onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_SCREEN).assertIsDisplayed()
            assertTrue(store.shown, "the prompt is recorded so it never nags again")
            assertEquals(0, finished.value, "the purchase flow waits for the optional step")

            onNodeWithTag(PayCraftTestTags.LINK_ACCOUNT_NOT_NOW).performClick()
            waitForIdle()
            assertEquals(1, finished.value)
        }
    }

    @Test
    fun a_purchase_that_already_has_an_identity_skips_the_prompt() {
        val billing = FakeBillingManager().apply { emitEmail("buyer@example.com") }
        val store = MemoryStore()
        runComposeUiTest {
            // The callback runs on the UI thread, the assertion on the test thread: a plain var
            // is not guaranteed visible across them, a StateFlow is.
            val finished = kotlinx.coroutines.flow.MutableStateFlow(0)
            setContent { gate(billing, store) { finished.value++ }() }
            billing.emitPremium(true)
            // The effect runs on the UI thread after the emission; wait for the outcome, not for idle.
            waitUntil(timeoutMillis = 5_000) { finished.value == 1 }
            assertEquals(1, finished.value)
            assertEquals(false, store.shown)
        }
    }

    @Test
    fun the_prompt_is_never_shown_twice() {
        val billing = FakeBillingManager()
        val store = MemoryStore().apply { shown = true }
        runComposeUiTest {
            // The callback runs on the UI thread, the assertion on the test thread: a plain var
            // is not guaranteed visible across them, a StateFlow is.
            val finished = kotlinx.coroutines.flow.MutableStateFlow(0)
            setContent { gate(billing, store) { finished.value++ }() }
            billing.emitPremium(true)
            waitUntil(timeoutMillis = 5_000) { finished.value == 1 }
            assertEquals(1, finished.value, "already offered once — go straight on")
        }
    }

    @Test
    fun already_premium_on_entry_is_not_a_purchase() {
        val billing = FakeBillingManager(premium = true)
        val store = MemoryStore()
        runComposeUiTest {
            // The callback runs on the UI thread, the assertion on the test thread: a plain var
            // is not guaranteed visible across them, a StateFlow is.
            val finished = kotlinx.coroutines.flow.MutableStateFlow(0)
            setContent { gate(billing, store) { finished.value++ }() }
            waitForIdle()
            assertEquals(0, finished.value)
            assertEquals(false, store.shown)
        }
    }
}
