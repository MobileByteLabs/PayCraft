package com.mobilebytelabs.paycraft.core.identity

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class ConsumerIdentityLinkTest {

    private class FakeAuth : ConsumerAuth {
        override val user = MutableStateFlow<ConsumerUser?>(null)
        var token: String? = "access-1"
        override fun accessToken(): String? = token
    }

    private class Harness(scope: TestScope, var outcome: ConsumerVerifyOutcome = ConsumerVerifyOutcome.Verified) {
        val auth = FakeAuth()
        val registered = mutableListOf<String>()
        val verified = mutableListOf<Pair<String, String>>()
        val linked = mutableListOf<String>()
        var unlinked = 0
        val link = ConsumerIdentityLink(
            auth = auth,
            register = { email ->
                registered += email
                "device-1"
            },
            verify = { access, device ->
                verified += access to device
                outcome
            },
            onLinked = { linked += it },
            onUnlinked = { unlinked++ },
            scope = scope.backgroundScope,
        ).also { it.start() }
    }

    private val ana = ConsumerUser(id = "u-1", email = "Ana@Example.com")

    @Test
    fun signedInUser_isRegisteredThenVerifiedThenLinked() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this)
        h.auth.user.value = ana

        assertEquals(listOf("ana@example.com"), h.registered)
        assertEquals(listOf("access-1" to "device-1"), h.verified)
        assertEquals(listOf("ana@example.com"), h.linked)
        assertEquals(ConsumerLinkState.Linked("ana@example.com"), h.link.state.value)
    }

    // The session observer re-emits the same user on every token refresh — one verification per user.
    @Test
    fun sameUserReEmitted_isVerifiedOnce() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this)
        h.auth.user.value = ana
        h.auth.user.value = ana.copy(email = "ana@example.com")

        assertEquals(1, h.verified.size)
    }

    @Test
    fun signOutAfterLink_unlinks() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this)
        h.auth.user.value = ana
        h.auth.user.value = null

        assertEquals(1, h.unlinked)
        assertEquals(ConsumerLinkState.Idle, h.link.state.value)
    }

    // Cold start: the session is still loading — "no user yet" must not sign a returning buyer out.
    @Test
    fun noUserBeforeAnyLink_neverUnlinks() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this)
        h.auth.user.value = null

        assertEquals(0, h.unlinked)
        assertTrue(h.registered.isEmpty())
    }

    @Test
    fun guestUser_isNotLinked() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this)
        h.auth.user.value = ConsumerUser(id = "g-1", email = null, isAnonymous = true)

        assertTrue(h.registered.isEmpty())
        assertEquals(ConsumerLinkState.Idle, h.link.state.value)
    }

    // The email was registered before the server proved it; a refused proof must not leave it bound.
    @Test
    fun rejectedToken_rollsBackAndFails() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this, ConsumerVerifyOutcome.Rejected)
        h.auth.user.value = ana

        assertEquals(1, h.unlinked)
        assertTrue(h.linked.isEmpty())
        assertEquals(ConsumerLinkState.Failed(ConsumerLinkFailure.Rejected), h.link.state.value)
    }

    @Test
    fun tenantWithoutIssuer_failsNotConfigured() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this, ConsumerVerifyOutcome.NotConfigured)
        h.auth.user.value = ana

        assertEquals(ConsumerLinkState.Failed(ConsumerLinkFailure.NotConfigured), h.link.state.value)
    }

    @Test
    fun userWithoutEmail_failsNoEmail() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this)
        h.auth.user.value = ConsumerUser(id = "u-2", email = " ")

        assertTrue(h.registered.isEmpty())
        assertEquals(ConsumerLinkState.Failed(ConsumerLinkFailure.NoEmail), h.link.state.value)
    }

    @Test
    fun missingAccessToken_failsWithoutCallingTheServer() = runTest(UnconfinedTestDispatcher()) {
        val h = Harness(this)
        h.auth.token = null
        h.auth.user.value = ana

        assertTrue(h.verified.isEmpty())
        assertEquals(1, h.unlinked)
        assertEquals(ConsumerLinkState.Failed(ConsumerLinkFailure.Unknown), h.link.state.value)
    }
}
