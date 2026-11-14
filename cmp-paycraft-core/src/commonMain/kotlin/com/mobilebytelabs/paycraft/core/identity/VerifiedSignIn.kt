package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.PayCraftInternalApi
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.OAuthProvider
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.encodeURLParameter
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/** What the identity screens render (PLAN-paycraft-verified-identity D6). */
sealed interface SignInState {
    data object Idle : SignInState
    data class Launching(val provider: OAuthProvider) : SignInState
    data class WaitingForBrowser(val provider: OAuthProvider) : SignInState
    data class Verifying(val provider: OAuthProvider) : SignInState
    data class Linked(val email: String, val provider: OAuthProvider) : SignInState
    data class Cancelled(val provider: OAuthProvider) : SignInState
    data class Failed(val provider: OAuthProvider, val reason: SignInFailure) : SignInState
}

enum class SignInFailure { NotConfigured, Network, Rejected, Unknown }

/** What a platform's native sign-in sheet produced. */
internal sealed interface NativeTokenResult {
    data class Token(val idToken: String) : NativeTokenResult

    data object Cancelled : NativeTokenResult

    /** No native path for this provider / no account / no Activity — use the browser flow. */
    data object Unavailable : NativeTokenResult

    data class Failed(val message: String?) : NativeTokenResult
}

/**
 * Which providers PayCraft can complete on [platform] with [suite]'s `auth` block. Nothing until config
 * has landed — a button that cannot finish is worse than none.
 *
 * Google: native on Android (needs the app's Web client id as `serverClientId`), browser elsewhere.
 * Apple: native on iOS, browser elsewhere only with the app's Services ID (Apple's web flow is per-app).
 */
@PayCraftInternalApi
fun availableProviders(platform: String, suite: SuiteConfig?): Set<OAuthProvider> {
    if (suite == null) return emptySet()
    val auth = suite.auth
    return buildSet {
        if (platform != "android" || !auth?.googleWebClientId.isNullOrBlank()) add(OAuthProvider.GOOGLE)
        if (platform == "ios" || !auth?.appleServicesId.isNullOrBlank()) add(OAuthProvider.APPLE)
    }
}

/** A fresh 64-char url-safe random string (2 × CSPRNG UUIDv4). Used for nonces and browser sessions. */
@OptIn(ExperimentalUuidApi::class)
internal fun randomUrlSafe(): String = Uuid.random().toHexString() + Uuid.random().toHexString()

/** Result of `POST identity-token/verify`. */
internal sealed interface VerifyOutcome {
    data class Verified(val email: String) : VerifyOutcome
    data object Rejected : VerifyOutcome
    data object Network : VerifyOutcome
}

/** Result of `POST identity-token/result`. */
internal sealed interface BrowserResult {
    data class Verified(val email: String) : BrowserResult
    data object Pending : BrowserResult
    data object Failed : BrowserResult
    data object NotFound : BrowserResult
    data object Network : BrowserResult
}

/** The `identity-token` edge function (D2/D3). Plain HTTP — no Supabase Auth, no `auth.users` row. */
internal class IdentityTokenClient(
    private val http: HttpClient,
    private val backend: PayCraftBackend,
    private val apiKey: String?,
    /** Sent to /start so /callback can hand control straight back to this app (D2b). */
    private val platform: String = authPlatform(com.mobilebytelabs.paycraft.core.currentPlatform()),
    /**
     * This device's id — the SAME value register_device sends. It goes with the sign-in (verify body, or /start for
     * the in-app browser) so the server marks this device identity-verified (migration 193).
     */
    private val deviceId: () -> String = { com.mobilebytelabs.paycraft.platform.PlatformInfo.deviceId },
) {
    private val base get() = "${backend.supabaseUrl}/functions/v1/identity-token"

    val isConfigured: Boolean get() = !apiKey.isNullOrBlank()

    fun startUrl(provider: OAuthProvider, session: String): String =
        "$base/start?api_key=${apiKey.orEmpty().encodeURLParameter()}&provider=${provider.wire}" +
            "&session=$session&platform=$platform&device_id=${deviceId().encodeURLParameter()}"

    suspend fun verify(provider: OAuthProvider, idToken: String, nonce: String?): VerifyOutcome = try {
        val response =
            postBody("verify", PayCraftContract.identityVerifyBody(apiKey, provider.wire, idToken, nonce, deviceId()))
        when {
            response.status.isSuccess() ->
                PayCraftContract.parseVerifiedEmail(response.body<JsonObject>())
                    ?.let { VerifyOutcome.Verified(it) } ?: VerifyOutcome.Rejected
            response.status.value in 400..499 -> VerifyOutcome.Rejected
            else -> VerifyOutcome.Network
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        PayCraftLogger.onError("identity.verify", e.message)
        VerifyOutcome.Network
    }

    suspend fun result(session: String): BrowserResult = try {
        val response = post("result") { put("session", session) }
        when {
            response.status == HttpStatusCode.NotFound -> BrowserResult.NotFound
            !response.status.isSuccess() -> BrowserResult.Network
            else -> {
                val body = response.body<JsonObject>()
                val email = body["email"]?.jsonPrimitive?.contentOrNull
                when (body["status"]?.jsonPrimitive?.contentOrNull) {
                    "verified" -> if (email.isNullOrBlank()) BrowserResult.Failed else BrowserResult.Verified(email)
                    "pending" -> BrowserResult.Pending
                    else -> BrowserResult.Failed
                }
            }
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        PayCraftLogger.onError("identity.result", e.message)
        BrowserResult.Network
    }

    private suspend fun post(route: String, fields: JsonObjectBuilder.() -> Unit): HttpResponse = postBody(
        route,
        buildJsonObject {
            put("api_key", apiKey.orEmpty())
            fields()
        },
    )

    private suspend fun postBody(route: String, body: JsonObject): HttpResponse = http.post("$base/$route") {
        header("Authorization", "Bearer ${backend.supabaseAnonKey}")
        header("apikey", backend.supabaseAnonKey)
        contentType(ContentType.Application.Json)
        setBody(body)
    }
}

internal val OAuthProvider.wire: String get() = name.lowercase()

/** identity-token's `platform` vocabulary: android | ios | web | desktop (macOS and anything else → desktop). */
internal fun authPlatform(platform: String): String = when (platform) {
    "android", "ios", "web" -> platform
    else -> "desktop"
}

/**
 * PayCraft's in-SDK sign-in WITHOUT Supabase users (PLAN-paycraft-verified-identity D5/D6): get a provider
 * ID token natively ([nativeToken]) or via the server-hosted browser flow, have `identity-token/verify`
 * prove it, and hand the verified email to [onVerified] (billing). Nothing signs in to Supabase.
 */
@PayCraftInternalApi
class VerifiedSignIn internal constructor(
    private val client: IdentityTokenClient,
    private val onVerified: suspend (String) -> Unit,
    private val nativeToken: suspend (OAuthProvider, String) -> NativeTokenResult = NativeIdTokenProvider::idToken,
    private val openBrowser: (String, (BrowserReturn) -> Unit) -> Unit = { url, onReturn ->
        InAppAuthBrowser.open(url, onReturn)
    },
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {
    private val _state = MutableStateFlow<SignInState>(SignInState.Idle)
    val state: StateFlow<SignInState> = _state.asStateFlow()

    /** Serialises browser-result polls: `/result` is one-time, so two concurrent reads would lose it. */
    private val pollLock = Mutex()
    private var session: String? = null
    private var browserPoll: Job? = null

    /** Fire-and-forget [signIn] for click handlers. */
    fun launch(provider: OAuthProvider) {
        scope.launch { signIn(provider) }
    }

    suspend fun signIn(provider: OAuthProvider) {
        if (!client.isConfigured) {
            _state.value = SignInState.Failed(provider, SignInFailure.NotConfigured)
            return
        }
        browserPoll?.cancel()
        session = null
        _state.value = SignInState.Launching(provider)
        val nonce = randomUrlSafe()
        when (
            val native = runCatching {
                nativeToken(provider, nonce)
            }.getOrElse { NativeTokenResult.Failed(it.message) }
        ) {
            is NativeTokenResult.Token -> verify(provider, native.idToken, nonce)
            NativeTokenResult.Cancelled -> _state.value = SignInState.Cancelled(provider)
            is NativeTokenResult.Failed -> {
                PayCraftLogger.onError("signIn", "native $provider: ${native.message}")
                _state.value = SignInState.Failed(provider, SignInFailure.Unknown)
            }
            NativeTokenResult.Unavailable -> startBrowser(provider)
        }
    }

    fun reset() {
        browserPoll?.cancel()
        session = null
        _state.value = SignInState.Idle
    }

    /** App returned to the foreground — the browser flow may have finished. A few quick tries. */
    fun onForeground() {
        if (_state.value !is SignInState.WaitingForBrowser) return
        scope.launch {
            for (wait in FOREGROUND_BACKOFF_MS) {
                delay(wait)
                if (pollBrowser(notFoundIsPending = false)) return@launch
            }
            // Back in the app with nothing finished: the user abandoned the browser.
            val waiting = _state.value as? SignInState.WaitingForBrowser ?: return@launch
            browserPoll?.cancel()
            session = null
            _state.value = SignInState.Cancelled(waiting.provider)
        }
    }

    private suspend fun verify(provider: OAuthProvider, idToken: String, nonce: String?) {
        _state.value = SignInState.Verifying(provider)
        when (val outcome = client.verify(provider, idToken, nonce)) {
            is VerifyOutcome.Verified -> linked(outcome.email, provider)
            VerifyOutcome.Rejected -> _state.value = SignInState.Failed(provider, SignInFailure.Rejected)
            VerifyOutcome.Network -> _state.value = SignInState.Failed(provider, SignInFailure.Network)
        }
    }

    private suspend fun linked(email: String, provider: OAuthProvider) {
        _state.value = SignInState.Linked(email, provider)
        runCatching { onVerified(email) }.onFailure { PayCraftLogger.onError("signIn", "onVerified: ${it.message}") }
    }

    private fun startBrowser(provider: OAuthProvider) {
        val id = randomUrlSafe()
        session = id
        _state.value = SignInState.WaitingForBrowser(provider)
        runCatching { openBrowser(client.startUrl(provider, id)) { onBrowserReturned(id, it) } }.onFailure {
            PayCraftLogger.onError("signIn", "openBrowser: ${it.message}")
            session = null
            _state.value = SignInState.Failed(provider, SignInFailure.Unknown)
            return
        }
        // Desktop/web have no foreground signal, so poll slowly until the server session expires.
        browserPoll = scope.launch {
            repeat(BACKGROUND_POLLS) {
                delay(BACKGROUND_POLL_MS)
                if (pollBrowser(notFoundIsPending = true)) return@launch
            }
        }
    }

    /**
     * The in-app browser reported its end (iOS). Completed → read `/result` now: the callback page only
     * redirects after the session row is final. Cancelled → the user closed the sheet.
     */
    private fun onBrowserReturned(id: String, how: BrowserReturn) {
        when (how) {
            BrowserReturn.Completed -> onForeground()
            BrowserReturn.Cancelled -> scope.launch {
                pollLock.withLock {
                    val waiting = _state.value as? SignInState.WaitingForBrowser ?: return@launch
                    if (session != id) return@launch
                    browserPoll?.cancel()
                    finish(SignInState.Cancelled(waiting.provider))
                }
            }
        }
    }

    /** One `/result` read. True when the flow reached a terminal state (or is no longer waiting). */
    private suspend fun pollBrowser(notFoundIsPending: Boolean): Boolean = pollLock.withLock {
        val waiting = _state.value as? SignInState.WaitingForBrowser ?: return true
        val id = session ?: return true
        val provider = waiting.provider
        when (val r = client.result(id)) {
            BrowserResult.Pending, BrowserResult.Network -> false
            // Not created yet (browser hasn't loaded /start) — or already consumed/expired.
            BrowserResult.NotFound -> if (notFoundIsPending) {
                false
            } else {
                finish(SignInState.Failed(provider, SignInFailure.Unknown))
                true
            }
            BrowserResult.Failed -> {
                finish(SignInState.Failed(provider, SignInFailure.Rejected))
                true
            }
            is BrowserResult.Verified -> {
                session = null
                _state.value = SignInState.Verifying(provider)
                linked(r.email, provider)
                true
            }
        }
    }

    private fun finish(state: SignInState) {
        session = null
        _state.value = state
    }

    internal companion object {
        val FOREGROUND_BACKOFF_MS = longArrayOf(0, 500, 1_000, 2_000)
        const val BACKGROUND_POLL_MS = 3_000L

        /** 15 min — the server's session TTL. */
        const val BACKGROUND_POLLS = 300
    }
}
