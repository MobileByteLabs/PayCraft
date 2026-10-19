package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.InitOptions
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.MonetizationMode
import com.mobilebytelabs.paycraft.repository.FakePayCraftRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The identity bind — the half of integration a consumer used to hand-write.
 *
 * `payCraft(...)` moved ~74 lines of per-app glue into the SDK. These assert the behaviour that
 * glue had to get right, so a consumer no longer can get it wrong:
 *
 *   · bind on EVERY change, not once (a second user must not inherit the first's subscription)
 *   · de-duplicate (a session Flow re-emits on token refresh; each would re-register the device)
 *   · ignore blanks (sign-out is not an identity)
 *
 * The initialize ORDER — before anything resolves a PayCraft singleton — is structural rather than
 * observable here: it is enforced by `initialize` running in the binder's `init`, with the
 * repository supplied as a lambda so it cannot be demanded before it exists. A test that asserted
 * ordering would be asserting Kotlin's constructor semantics.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PayCraftIdentityBinderTest {

    private fun binder(
        emails: MutableStateFlow<String?>,
        repo: FakePayCraftRepository,
        // `backgroundScope`, never the test's own scope. The binder collects the identity Flow for
        // the life of the app, so that collector never completes — `runTest(this)` waits a minute
        // and then fails with UncompletedCoroutinesError. This is the seam kotlinx-coroutines-test
        // provides for exactly that: a long-lived collaborator, cancelled when the test body ends.
        //
        // Paired with UnconfinedTestDispatcher on every test here. Under StandardTestDispatcher
        // the `launch` is only QUEUED, so the collector had not started when the first value was
        // set and every assertion saw zero calls — a false red that looks exactly like a broken
        // binder. Unconfined starts the collector eagerly, which is what a subscribe-forever
        // collaborator needs.
        scope: CoroutineScope,
    ) = PayCraftIdentityBinder(
        email = emails,
        repository = { repo },
        apiKey = "pk_test_binder",
        testApiKey = null,
        // Mock: this must not reach a network. A Cloud backend would make the test depend on the
        // SDK's real Supabase constants.
        backend = PayCraftBackend.Mock(staticConfig = SuiteConfig(tenantId = "t")),
        options = InitOptions(),
        mode = MonetizationMode.AdSupported,
        scope = scope,
    )

    @Test
    fun binds_the_signed_in_email() = runTest(UnconfinedTestDispatcher()) {
        val repo = FakePayCraftRepository()
        val emails = MutableStateFlow<String?>(null)
        binder(emails, repo, backgroundScope)
        emails.value = "buyer@example.com"
        advanceUntilIdle()
        assertEquals(listOf("buyer@example.com"), repo.logInCalls)
    }

    @Test
    fun rebinds_when_a_different_user_signs_in() = runTest(UnconfinedTestDispatcher()) {
        // THE case this exists for. Binding once would leave the second user holding the first
        // user's entitlement — a paying customer's subscription silently granted to whoever signs
        // in next on that device.
        val repo = FakePayCraftRepository()
        val emails = MutableStateFlow<String?>("first@example.com")
        binder(emails, repo, backgroundScope)
        advanceUntilIdle()
        emails.value = "second@example.com"
        advanceUntilIdle()
        assertEquals(listOf("first@example.com", "second@example.com"), repo.logInCalls)
    }

    @Test
    fun ignores_a_repeat_of_the_same_address() = runTest(UnconfinedTestDispatcher()) {
        // A session Flow re-emits on every token refresh. Without distinctUntilChanged each
        // refresh re-registers the device, which on a one-device-per-subscription backend looks
        // like a device conflict the user never caused.
        val repo = FakePayCraftRepository()
        val emails = MutableStateFlow<String?>("buyer@example.com")
        binder(emails, repo, backgroundScope)
        advanceUntilIdle()
        emails.value = "buyer@example.com"
        emails.value = "  buyer@example.com  " // whitespace is not a different user
        advanceUntilIdle()
        assertEquals(1, repo.logInCalls.size)
    }

    @Test
    fun ignores_sign_out() = runTest(UnconfinedTestDispatcher()) {
        // Sign-out emits null/blank. Passing that through would tell the SDK the user is "",
        // rather than leaving the last identity in place — the SDK has its own logOut for this.
        val repo = FakePayCraftRepository()
        val emails = MutableStateFlow<String?>("buyer@example.com")
        binder(emails, repo, backgroundScope)
        advanceUntilIdle()
        emails.value = null
        emails.value = ""
        advanceUntilIdle()
        assertEquals(listOf("buyer@example.com"), repo.logInCalls)
    }

    @Test
    fun an_app_with_no_accounts_binds_nothing() = runTest(UnconfinedTestDispatcher()) {
        // `identity` defaults to emptyFlow(): an app entitled by device alone needs no auth, and
        // must not be forced to invent one.
        val repo = FakePayCraftRepository()
        binder(MutableStateFlow(null), repo, backgroundScope)
        advanceUntilIdle()
        assertEquals(emptyList(), repo.logInCalls)
    }
}
