package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import io.ktor.client.HttpClient
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.launch

/**
 * The CONSUMER app's sign-in, as PayCraft needs it (PLAN paycraft-consumer-supabase-identity D1/D2).
 *
 * Every app using PayCraft signs its users in to its OWN Supabase. PayCraft never signs anyone in: it
 * takes that session's access token and has `identity-verify` check it against the tenant's
 * `auth_issuer_url` JWKS. `cmp-paycraft` adapts a kmp-supabase-auth client to this port; core stays free of
 * auth dependencies so the web bundle does not carry them.
 */
interface ConsumerAuth {
    /** The signed-in user; null while signed out (or while the session is still loading). */
    val user: Flow<ConsumerUser?>

    /** The current session's access token, or null without a session. */
    fun accessToken(): String?

    /**
     * The user of each NEW sign-in (not a token refresh, not a session loaded from storage). [user] cannot tell
     * a same-account re-sign-in apart from nothing happening; this can. Empty by default.
     */
    val signIns: Flow<ConsumerUser> get() = emptyFlow()
}

data class ConsumerUser(val id: String, val email: String?, val isAnonymous: Boolean = false)

sealed interface ConsumerLinkState {
    data object Idle : ConsumerLinkState
    data object Linking : ConsumerLinkState
    data class Linked(val email: String) : ConsumerLinkState
    data class Failed(val reason: ConsumerLinkFailure) : ConsumerLinkState
}

enum class ConsumerLinkFailure { NoEmail, NotConfigured, Rejected, Network, Unknown }

sealed interface ConsumerVerifyOutcome {
    data object Verified : ConsumerVerifyOutcome
    data object NotConfigured : ConsumerVerifyOutcome
    data object Rejected : ConsumerVerifyOutcome
    data object Network : ConsumerVerifyOutcome
}

/**
 * Keeps PayCraft's buyer in step with the consumer's signed-in user (D3 silent link, D8 logout).
 *
 * A real user appears → register this device for their email → `identity-verify` proves the session → linked.
 * Register comes first because `identity-verify` binds an existing device token (the web SDK does the same).
 * A refused proof rolls the registration back, so an unproven email never stays bound. Each user is verified
 * once per process; token refreshes re-emit the same user and are ignored. Sign-out unlinks — but only a
 * sign-out seen AFTER a link, so a cold start (no user while the session loads) never signs a buyer out.
 */
class ConsumerIdentityLink(
    private val auth: ConsumerAuth,
    private val register: suspend (email: String) -> String?,
    private val verify: suspend (accessToken: String, deviceToken: String) -> ConsumerVerifyOutcome,
    private val onLinked: suspend (email: String) -> Unit,
    private val onUnlinked: () -> Unit,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<ConsumerLinkState>(ConsumerLinkState.Idle)
    val state: StateFlow<ConsumerLinkState> = _state.asStateFlow()

    private var linkedUserId: String? = null

    fun start() {
        scope.launch {
            auth.user.distinctUntilChangedBy { it?.id }.collect { user ->
                when {
                    user == null || user.isAnonymous -> unlinkIfLinked()
                    user.id != linkedUserId -> link(user)
                }
            }
        }
        // The buyer signed in again as the account already linked (Restore → the same Google account): the user
        // flow stays silent, so without this nothing re-checks and the screen never gets an answer. Another
        // account's sign-in is left to the user flow above, which links it once.
        scope.launch {
            auth.signIns.collect { user -> if (user.id == linkedUserId) link(user) }
        }
    }

    private fun unlinkIfLinked() {
        if (linkedUserId == null) return
        linkedUserId = null
        onUnlinked()
        _state.value = ConsumerLinkState.Idle
    }

    // The app's own sign-in must never crash it: any register / verify failure is a failed link, reported.
    @Suppress("TooGenericExceptionCaught")
    private suspend fun link(user: ConsumerUser) {
        val email = user.email?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
            ?: return fail(ConsumerLinkFailure.NoEmail, rollBack = false)
        _state.value = ConsumerLinkState.Linking
        val outcome = try {
            val device = register(email)
            val access = auth.accessToken()
            if (device == null || access == null) null else verify(access, device)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            PayCraftLogger.onError("consumerIdentity", e.message)
            ConsumerVerifyOutcome.Network
        }
        when (outcome) {
            ConsumerVerifyOutcome.Verified -> {
                linkedUserId = user.id
                _state.value = ConsumerLinkState.Linked(email)
                runCatching { onLinked(email) }.onFailure { PayCraftLogger.onError("consumerIdentity", it.message) }
            }

            ConsumerVerifyOutcome.NotConfigured -> fail(ConsumerLinkFailure.NotConfigured)

            ConsumerVerifyOutcome.Rejected -> fail(ConsumerLinkFailure.Rejected)

            ConsumerVerifyOutcome.Network -> fail(ConsumerLinkFailure.Network)

            null -> fail(ConsumerLinkFailure.Unknown)
        }
    }

    private fun fail(reason: ConsumerLinkFailure, rollBack: Boolean = true) {
        PayCraftLogger.onError("consumerIdentity", "link failed: $reason")
        if (rollBack) onUnlinked()
        _state.value = ConsumerLinkState.Failed(reason)
    }
}

/** `POST identity-verify` — the consumer session's access token + this device's PayCraft token. */
internal class ConsumerSessionVerifier(
    private val http: HttpClient,
    private val backend: PayCraftBackend,
    private val apiKey: String?,
) {
    // A network boundary: whatever the HTTP stack throws becomes Network, never a crash in the host app.
    @Suppress("TooGenericExceptionCaught")
    suspend fun verify(
        accessToken: String,
        deviceToken: String,
        platform: String,
        deviceName: String?,
    ): ConsumerVerifyOutcome = try {
        val response = http.post(PayCraftContract.consumerSessionVerifyUrl(backend.supabaseUrl)) {
            header("Authorization", "Bearer ${backend.supabaseAnonKey}")
            header("apikey", backend.supabaseAnonKey)
            contentType(ContentType.Application.Json)
            setBody(
                PayCraftContract.consumerSessionVerifyBody(apiKey, accessToken, deviceToken, platform, deviceName),
            )
        }
        when {
            response.status.isSuccess() -> ConsumerVerifyOutcome.Verified
            response.status == HttpStatusCode.Conflict -> ConsumerVerifyOutcome.NotConfigured
            response.status.value in CLIENT_ERRORS -> ConsumerVerifyOutcome.Rejected
            else -> ConsumerVerifyOutcome.Network
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        PayCraftLogger.onError("identity-verify", e.message)
        ConsumerVerifyOutcome.Network
    }

    private companion object {
        /** 4xx: identity-verify refused the token (bad signature, expired, wrong issuer, device of another account). */
        val CLIENT_ERRORS = 400..499
    }
}
