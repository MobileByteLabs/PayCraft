package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.AuthClientsDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.model.OAuthProvider
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.TextContent
import io.ktor.http.headersOf
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * PayCraft's verified identity (PLAN-paycraft-verified-identity D5/D6): a provider ID token — native or
 * from the server-hosted browser flow — is verified by identity-token, and only then reaches billing.
 */
class VerifiedSignInTest {

    private class Server(private val engineDispatcher: CoroutineDispatcher) {
        val requests = mutableListOf<Pair<String, String>>() // (route, body)
        var verify: Pair<HttpStatusCode, String> =
            HttpStatusCode.OK to """{"email":"buyer@example.com","provider":"google"}"""
        val results = ArrayDeque<Pair<HttpStatusCode, String>>()
        var throwOnVerify = false

        val engine = MockEngine.create {
            // On the test scheduler, so advanceUntilIdle covers the polls' HTTP round-trips too.
            dispatcher = engineDispatcher
            addHandler { req: HttpRequestData ->
                val route = req.url.encodedPath.substringAfterLast('/')
                requests += route to ((req.body as? TextContent)?.text ?: "")
                if (route == "verify" && throwOnVerify) error("offline")
                val (status, body) = when (route) {
                    "verify" -> verify
                    "result" -> results.removeFirstOrNull() ?: (HttpStatusCode.OK to """{"status":"pending"}""")
                    else -> HttpStatusCode.NotFound to "{}"
                }
                respond(body, status, headersOf(HttpHeaders.ContentType, "application/json"))
            }
        }
    }

    private val backend = PayCraftBackend.SelfHosted(supabaseUrl = "https://ref.supabase.co", supabaseAnonKey = "anon")

    private fun TestScope.signIn(
        server: Server,
        native: NativeTokenResult,
        opened: MutableList<String> = mutableListOf(),
        verified: MutableList<String> = mutableListOf(),
        apiKey: String? = "pk_test_1",
    ) = VerifiedSignIn(
        client = IdentityTokenClient(
            HttpClient(server.engine) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } },
            backend,
            apiKey,
        ),
        onVerified = { verified += it },
        nativeToken = { _, _ -> native },
        openBrowser = { opened += it },
        scope = this, // foreground: advanceUntilIdle drives the polls; every browser test ends terminal
    )

    @Test
    fun native_token_verified_links_and_reaches_billing() = runTest {
        val server = Server(StandardTestDispatcher(testScheduler))
        val verified = mutableListOf<String>()
        val sut = signIn(server, NativeTokenResult.Token("id-tok"), verified = verified)

        sut.signIn(OAuthProvider.GOOGLE)

        assertEquals(SignInState.Linked("buyer@example.com", OAuthProvider.GOOGLE), sut.state.value)
        assertEquals(listOf("buyer@example.com"), verified)
        val (route, body) = server.requests.single()
        assertEquals("verify", route)
        assertTrue(
            """"id_token":"id-tok"""" in body && """"provider":"google"""" in body && """"nonce":"""" in body,
            body,
        )
    }

    @Test
    fun native_cancel_is_cancelled_and_calls_nothing() = runTest {
        val server = Server(StandardTestDispatcher(testScheduler))
        val sut = signIn(server, NativeTokenResult.Cancelled)
        sut.signIn(OAuthProvider.APPLE)
        assertEquals(SignInState.Cancelled(OAuthProvider.APPLE), sut.state.value)
        assertTrue(server.requests.isEmpty())
    }

    @Test
    fun verify_401_is_rejected() = runTest {
        val server = Server(StandardTestDispatcher(testScheduler)).apply {
            verify =
                HttpStatusCode.Unauthorized to """{"error":"invalid_identity_token"}"""
        }
        val verified = mutableListOf<String>()
        val sut = signIn(server, NativeTokenResult.Token("forged"), verified = verified)
        sut.signIn(OAuthProvider.GOOGLE)
        assertEquals(SignInState.Failed(OAuthProvider.GOOGLE, SignInFailure.Rejected), sut.state.value)
        assertTrue(verified.isEmpty())
    }

    @Test
    fun network_error_is_network_failure() = runTest {
        val server = Server(StandardTestDispatcher(testScheduler)).apply { throwOnVerify = true }
        val sut = signIn(server, NativeTokenResult.Token("t"))
        sut.signIn(OAuthProvider.GOOGLE)
        assertEquals(SignInState.Failed(OAuthProvider.GOOGLE, SignInFailure.Network), sut.state.value)
    }

    @Test
    fun no_api_key_is_not_configured() = runTest {
        val sut = signIn(Server(StandardTestDispatcher(testScheduler)), NativeTokenResult.Token("t"), apiKey = null)
        sut.signIn(OAuthProvider.GOOGLE)
        assertEquals(SignInState.Failed(OAuthProvider.GOOGLE, SignInFailure.NotConfigured), sut.state.value)
    }

    @Test
    fun browser_flow_waits_then_links_on_foreground() = runTest {
        val server = Server(StandardTestDispatcher(testScheduler))
        val opened = mutableListOf<String>()
        val verified = mutableListOf<String>()
        val sut = signIn(server, NativeTokenResult.Unavailable, opened, verified)

        sut.signIn(OAuthProvider.APPLE)
        assertEquals(SignInState.WaitingForBrowser(OAuthProvider.APPLE), sut.state.value)
        val url = opened.single()
        assertTrue(url.startsWith("https://ref.supabase.co/functions/v1/identity-token/start?"), url)
        assertTrue("provider=apple" in url && "api_key=pk_test_1" in url && "session=" in url, url)

        server.results += HttpStatusCode.OK to """{"status":"pending"}"""
        server.results += HttpStatusCode.OK to """{"status":"verified","email":"apple@example.com"}"""
        sut.onForeground()
        advanceUntilIdle()

        assertEquals(SignInState.Linked("apple@example.com", OAuthProvider.APPLE), sut.state.value)
        assertEquals(listOf("apple@example.com"), verified)
        val session = url.substringAfter("session=")
        assertTrue(server.requests.filter { it.first == "result" }.all { session in it.second })
    }

    @Test
    fun browser_flow_failed_result_is_rejected() = runTest {
        val server = Server(StandardTestDispatcher(testScheduler))
        val sut = signIn(server, NativeTokenResult.Unavailable)
        sut.signIn(OAuthProvider.GOOGLE)
        server.results += HttpStatusCode.OK to """{"status":"failed","error":"invalid"}"""
        sut.onForeground()
        runCurrent()
        assertEquals(SignInState.Failed(OAuthProvider.GOOGLE, SignInFailure.Rejected), sut.state.value)
    }

    @Test
    fun returning_without_finishing_the_browser_is_cancelled() = runTest {
        val server = Server(StandardTestDispatcher(testScheduler)) // /result stays pending
        val sut = signIn(server, NativeTokenResult.Unavailable)
        sut.signIn(OAuthProvider.GOOGLE)
        sut.onForeground()
        advanceUntilIdle()
        assertEquals(SignInState.Cancelled(OAuthProvider.GOOGLE), sut.state.value)
    }

    @Test
    fun background_poll_completes_without_a_foreground_signal() = runTest {
        // Desktop / web: no foreground hook — the slow poll alone must finish the flow.
        val server = Server(StandardTestDispatcher(testScheduler))
        val verified = mutableListOf<String>()
        val sut = signIn(server, NativeTokenResult.Unavailable, verified = verified)
        sut.signIn(OAuthProvider.GOOGLE)
        server.results += HttpStatusCode.NotFound to """{"error":"session_not_found"}""" // /start not hit yet
        server.results += HttpStatusCode.OK to """{"status":"verified","email":"web@example.com"}"""
        advanceUntilIdle()
        assertEquals(SignInState.Linked("web@example.com", OAuthProvider.GOOGLE), sut.state.value)
        assertEquals(listOf("web@example.com"), verified)
    }

    @Test
    fun reset_returns_to_idle() = runTest {
        val sut = signIn(Server(StandardTestDispatcher(testScheduler)), NativeTokenResult.Cancelled)
        sut.signIn(OAuthProvider.GOOGLE)
        sut.reset()
        assertEquals(SignInState.Idle, sut.state.value)
    }

    @Test
    fun providers_follow_platform_and_config() {
        val none = SuiteConfig(tenantId = "t")
        val both =
            SuiteConfig(tenantId = "t", auth = AuthClientsDto(googleWebClientId = "web", appleServicesId = "svc"))
        assertEquals(emptySet(), availableProviders("android", null))
        // Android: Google only natively (needs the Web client); Apple only via its Services ID.
        assertEquals(emptySet(), availableProviders("android", none))
        assertEquals(setOf(OAuthProvider.GOOGLE, OAuthProvider.APPLE), availableProviders("android", both))
        // iOS: Apple always (native); Google via browser.
        assertEquals(setOf(OAuthProvider.GOOGLE, OAuthProvider.APPLE), availableProviders("ios", none))
        // Desktop / web: Google via browser; Apple only with a Services ID.
        assertEquals(setOf(OAuthProvider.GOOGLE), availableProviders("desktop", none))
        assertEquals(setOf(OAuthProvider.GOOGLE, OAuthProvider.APPLE), availableProviders("web", both))
    }

    @Test
    fun nonces_and_sessions_are_long_url_safe_and_fresh() {
        val a = randomUrlSafe()
        assertTrue(a.length >= 32 && a.all { it.isLetterOrDigit() || it == '-' || it == '_' }, a)
        assertTrue(a != randomUrlSafe())
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
