package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.testsupport.FakePayCraftService
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.status.SessionStatus
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthClient
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthProvider
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthUser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * A native Apple / Google sign-in on PayCraft's own client identifies the buyer (PLAN-paycraft-
 * native-identity D3) — the step that moves a store purchase from the anonymous device id to the
 * email, so it restores on the other platform. An anonymous session must NOT identify anyone.
 */
class NativeSignInIdentityTest {

    private class FakeIdentity : KmpSupabaseAuthClient {
        val user = MutableStateFlow<KmpSupabaseAuthUser?>(null)
        override val isConfigured = true
        override val raw: SupabaseClient? = null
        override val sessionStatus: Flow<SessionStatus>? = null
        override val currentUser: Flow<KmpSupabaseAuthUser?> = user
        override val isSignedIn: Flow<Boolean> = user.map { it != null }
        override val supportsNativeGoogle = true
        override suspend fun signInAnonymously() = Result.success(Unit)
        override suspend fun signInWithAppleFallback() = Result.success(Unit)
        override suspend fun signInWithGoogleFallback() = Result.success(Unit)
        override suspend fun hasRestorableSession() = false
        override fun currentAccessToken(): String? = null
        override suspend fun signOut() = Result.success(Unit)
    }

    private class MemoryStore : PayCraftStore {
        var email: String? = null
        override suspend fun saveEmail(email: String) {
            this.email = email
        }
        override suspend fun getEmail(): String? = email
        override suspend fun clearEmail() {
            email = null
        }
    }

    private fun manager(identity: FakeIdentity) = PayCraftBillingManager(
        service = FakePayCraftService(),
        store = MemoryStore(),
        identity = identity,
        dispatcher = Dispatchers.Default,
    )

    @Test
    fun a_native_apple_sign_in_identifies_the_buyer() = runTest {
        val identity = FakeIdentity()
        val manager = manager(identity)

        identity.user.value =
            KmpSupabaseAuthUser(id = "u1", email = "Buyer@Example.com", provider = KmpSupabaseAuthProvider.APPLE)

        val email = withContext(Dispatchers.Default) { withTimeout(5_000) { manager.userEmail.first { it != null } } }
        assertEquals("buyer@example.com", email)
    }

    @Test
    fun an_anonymous_session_identifies_no_one() = runTest {
        val identity = FakeIdentity()
        val manager = manager(identity)

        identity.user.value = KmpSupabaseAuthUser(id = "anon", isAnonymous = true)
        withContext(Dispatchers.Default) { delay(300) }

        assertNull(manager.userEmail.value)
    }
}
