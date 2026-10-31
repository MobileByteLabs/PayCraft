package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.config.AuthClientsDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
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
import kotlinx.serialization.json.Json
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
        identity = MutableStateFlow(identity),
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

    @Test
    fun a_client_built_after_config_lands_still_identifies_the_buyer() = runTest {
        val identity = FakeIdentity()
        val clients = MutableStateFlow<KmpSupabaseAuthClient?>(null)
        val manager = PayCraftBillingManager(
            service = FakePayCraftService(),
            store = MemoryStore(),
            identity = clients,
            dispatcher = Dispatchers.Default,
        )
        identity.user.value =
            KmpSupabaseAuthUser(id = "u1", email = "late@example.com", provider = KmpSupabaseAuthProvider.GOOGLE)
        clients.value = identity

        val email = withContext(Dispatchers.Default) { withTimeout(5_000) { manager.userEmail.first { it != null } } }
        assertEquals("late@example.com", email)
    }

    @Test
    fun the_apps_ids_from_config_become_the_sign_in_config() {
        val cfg = NativeSignIn.configFor(
            AuthClientsDto(googleWebClientId = "web-id", appleServicesId = "com.app.signin"),
            supabaseUrl = "https://abcref.supabase.co",
            appId = "com.app",
        )
        assertEquals("abcref", cfg.projectRef)
        assertEquals("web-id", cfg.googleWebClientId)
        assertEquals("com.app.signin", cfg.appleServiceId)
        assertEquals("com.app://login-callback/paycraft", cfg.redirectUrl)
        assertEquals(
            "",
            NativeSignIn.configFor(AuthClientsDto(), "https://abcref.supabase.co", "com.app").googleWebClientId,
        )
    }

    @Test
    fun config_without_an_auth_block_decodes_to_null() {
        val json = Json { ignoreUnknownKeys = true }
        assertNull(json.decodeFromString<SuiteConfig>("""{"tenant_id":"t"}""").auth)
        assertEquals(
            "com.app.signin",
            json.decodeFromString<SuiteConfig>(
                """{"tenant_id":"t","auth":{"google_web_client_id":null,"apple_services_id":"com.app.signin"}}""",
            ).auth?.appleServicesId,
        )
    }
}
