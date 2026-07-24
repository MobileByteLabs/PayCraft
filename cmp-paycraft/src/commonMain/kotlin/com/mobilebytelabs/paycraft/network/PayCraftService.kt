package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionState
import kotlin.time.ExperimentalTime
import kotlin.time.Instant
import io.github.jan.supabase.SupabaseClient
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import io.github.jan.supabase.auth.OtpType
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.Apple
import io.github.jan.supabase.auth.providers.Google
import io.github.jan.supabase.auth.providers.builtin.IDToken
import io.github.jan.supabase.auth.providers.builtin.OTP
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.postgrest.rpc
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Serializable
data class SubscriptionDto(
    val id: String? = null,
    val email: String,
    val provider: String? = null,
    val plan: String? = null,
    val status: String? = null,
    @SerialName("current_period_end")
    val currentPeriodEnd: String? = null,
    @SerialName("cancel_at_period_end")
    val cancelAtPeriodEnd: Boolean? = null,
    @SerialName("trial_start")
    val trialStart: String? = null,
    @SerialName("trial_end")
    val trialEnd: String? = null,
)

/**
 * Server-authoritative reconciled entitlement record (Phase 2 reconciliation engine output),
 * keyed by the STABLE app-user-id (D5) — NOT the store account. This is what the Store5
 * cache's [com.mobilebytelabs.paycraft.persistence.EntitlementCache] fetches through and what
 * cross-platform restore reconciles to (one canonical record shared across iOS/Android/web).
 *
 * Timestamps are epoch-millis here (as the `get_entitlements` RPC / `Entitlement.sq` INTEGER
 * columns carry them); they are converted to the canonical model's ISO-8601 strings by
 * [toEntitlement].
 */
@Serializable
data class EntitlementDto(
    @SerialName("app_user_id")
    val appUserId: String,
    val provider: String,
    @SerialName("product_id")
    val productId: String,
    // trial | active | active_non_renewing | in_grace_period | on_billing_retry | paused |
    // expired | cancelled | refunded | pending
    @SerialName("canonical_state")
    val canonicalState: String,
    @SerialName("expires_at")
    val expiresAt: Long? = null,
    @SerialName("in_grace_until")
    val inGraceUntil: Long? = null,
    @SerialName("will_renew")
    val willRenew: Boolean = true,
    @SerialName("is_sandbox")
    val isSandbox: Boolean = false,
    @SerialName("subscription_id")
    val subscriptionId: String? = null,
    @SerialName("latest_event_ts")
    val latestEventTs: Long = 0L,
)

// ─── Device-binding result types ─────────────────────────────────────────────

data class RegisterDeviceResult(
    val deviceToken: String,
    val conflict: Boolean,
    val conflictingDeviceName: String?,
    val conflictingLastSeen: String?,
)

data class PremiumCheckResult(val isPremium: Boolean, val tokenValid: Boolean)

data class OtpGateResult(val available: Boolean, val sendsToday: Int, val limit: Int)

// ─── Interface ────────────────────────────────────────────────────────────────

interface PayCraftService {
    // Server-token-based RPCs (Migration 013 — token replaces email in all queries)
    suspend fun isPremium(serverToken: String): Boolean
    suspend fun getSubscription(serverToken: String): SubscriptionDto?

    /**
     * Server-derived trial eligibility (Migration 026 — TR-006).
     *
     * Returns `true` iff the email bound to [serverToken] has no historical
     * subscription row with `trial_end IS NOT NULL`. Once a trial is recorded,
     * no second trial is possible. Returns `true` for an unregistered token
     * (treat as new user — adopt-flow may call before login completes).
     *
     * Network failures return `false` (conservative — better to suppress a
     * trial CTA than to wrongly offer one to a user who's already trialed).
     */
    suspend fun isTrialEligible(serverToken: String): Boolean

    // Device registration (entry point — still requires email)
    suspend fun registerDevice(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String = "live",
    ): RegisterDeviceResult

    // Server-token-based device RPCs
    suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult
    suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean
    suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean

    suspend fun checkOtpGate(): OtpGateResult

    // OTP ownership verification
    suspend fun sendOtp(email: String)
    suspend fun verifyOtp(email: String, token: String): Boolean

    /**
     * Verifies a Google or Apple ID token via Supabase Auth (Gate 1).
     * Returns the verified email address, or null if verification fails.
     */
    suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String?

    /**
     * Server-authoritative reconciled entitlement, keyed by the STABLE app-user-id (D5).
     *
     * This is the Store5 cache Fetcher's backing call — it hits the reconciliation engine's
     * `get_entitlements` RPC, which has already ingested every provider's notifications,
     * re-fetched the store server APIs, and reconciled to ONE canonical record. Returns null
     * when the user has no entitlement (or on network failure — the Store5 SourceOfTruth then
     * serves the offline last-known-good, AC9).
     *
     * Default is null so alternate [PayCraftService] fakes/mocks stay source-compatible.
     */
    suspend fun getEntitlements(appUserId: String): EntitlementDto? = null

    /**
     * PSP-API subscription cancel for Stripe / Razorpay (D7). Native-store subscriptions are
     * NEVER cancelled through this path — stores forbid programmatic cancel, so they deep-link
     * to the store subscription centre instead (see
     * [com.mobilebytelabs.paycraft.billing.NativeBillingClient.manageSubscription]).
     *
     * @return true when the engine accepted the cancel request.
     * Default is false so alternate [PayCraftService] fakes/mocks stay source-compatible.
     */
    suspend fun cancelSubscription(provider: String, subscriptionId: String): Boolean = false

    /**
     * Register a completed **Google Play** purchase server-side (Payments-policy native lane).
     *
     * POSTs to the `register-play-purchase` edge function, which (1) re-fetches truth from the Play
     * Developer API (`purchases.subscriptionsv2.get`), (2) rejects a purchaseToken already bound to a
     * different user (replay), and (3) reconciles ONE canonical entitlement via the E2 engine. The
     * reconciled [EntitlementDto] is returned so the client can reflect premium immediately.
     *
     * @param purchaseToken the Play `Purchase.purchaseToken` (stable across renewals).
     * @param productId the Play subscription product id that was purchased.
     * @param appUserId the STABLE app-user-id the entitlement is keyed on (email or device id).
     * @param packageName the buying app's package (`Purchase.packageName`) — keys the Play re-fetch.
     * @return the reconciled entitlement, or null on failure. Default null keeps fakes/mocks
     *   source-compatible.
     */
    suspend fun registerPlayPurchase(
        purchaseToken: String,
        productId: String,
        appUserId: String,
        packageName: String,
    ): EntitlementDto? = null
}

/** Wire shape of the `register-play-purchase` edge-function response. */
@Serializable
data class RegisterPlayPurchaseResponse(val entitlement: EntitlementDto? = null)

// ─── Implementation ───────────────────────────────────────────────────────────

class PayCraftServiceImpl(private val client: SupabaseClient, private val apiKey: String? = null) : PayCraftService {

    private val postgrest get() = client.postgrest
    private val auth get() = client.auth

    override suspend fun isPremium(serverToken: String): Boolean = try {
        PayCraftLogger.onRpcCall("is_premium", "token=${serverToken.take(12)}...")
        val result = postgrest.rpc(
            function = "is_premium",
            parameters = buildJsonObject {
                put("p_server_token", serverToken)
                apiKey?.let { put("p_api_key", it) }
            },
        ).data
        val decoded = result.trim().toBooleanStrictOrNull() ?: false
        PayCraftLogger.onRpcResult("is_premium", decoded.toString())
        decoded
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("is_premium", e.message)
        false
    }

    override suspend fun getSubscription(serverToken: String): SubscriptionDto? = try {
        PayCraftLogger.onRpcCall("get_subscription", "token=${serverToken.take(12)}...")
        val sub = postgrest.rpc(
            function = "get_subscription",
            parameters = buildJsonObject {
                put("p_server_token", serverToken)
                apiKey?.let { put("p_api_key", it) }
            },
        ).decodeList<SubscriptionDto>().firstOrNull()
        PayCraftLogger.onRpcResult(
            "get_subscription",
            if (sub != null) "plan=${sub.plan}, status=${sub.status}" else "null",
        )
        sub
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("get_subscription", e.message)
        null
    }

    override suspend fun isTrialEligible(serverToken: String): Boolean = try {
        PayCraftLogger.onRpcCall("is_trial_eligible", "token=${serverToken.take(12)}...")
        val result = postgrest.rpc(
            function = "is_trial_eligible",
            parameters = buildJsonObject {
                put("p_server_token", serverToken)
                apiKey?.let { put("p_api_key", it) }
            },
        ).data
        val decoded = result.trim().toBooleanStrictOrNull() ?: false
        PayCraftLogger.onRpcResult("is_trial_eligible", decoded.toString())
        decoded
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("is_trial_eligible", e.message)
        false
    }

    override suspend fun registerDevice(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String,
    ): RegisterDeviceResult {
        PayCraftLogger.onRpcCall(
            "register_device",
            "email=***, platform=$platform, device=$deviceName, mode=$mode",
        )
        val r = postgrest.rpc(
            function = "register_device",
            parameters = buildJsonObject {
                put("p_email", email)
                put("p_platform", platform)
                put("p_device_name", deviceName)
                put("p_device_id", deviceId)
                put("p_mode", mode)
                apiKey?.let { put("p_api_key", it) }
            },
        ).decodeAs<JsonObject>()
        val result = RegisterDeviceResult(
            deviceToken = r["server_token"]!!.jsonPrimitive.content,
            conflict = r["conflict"]?.jsonPrimitive?.boolean ?: false,
            conflictingDeviceName = r["conflicting_device_name"]?.jsonPrimitive?.contentOrNull,
            conflictingLastSeen = r["conflicting_last_seen"]?.jsonPrimitive?.contentOrNull,
        )
        PayCraftLogger.onRpcResult(
            "register_device",
            "token=${result.deviceToken.take(
                20,
            )}, conflict=${result.conflict}, conflictDevice=${result.conflictingDeviceName}",
        )
        return result
    }

    override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult {
        PayCraftLogger.onRpcCall("check_premium_with_device", "token=${serverToken.take(12)}...")
        val r = postgrest.rpc(
            function = "check_premium_with_device",
            parameters = buildJsonObject {
                put("p_server_token", serverToken)
                apiKey?.let { put("p_api_key", it) }
            },
        ).decodeAs<JsonObject>()
        val result = PremiumCheckResult(
            isPremium = r["is_premium"]?.jsonPrimitive?.boolean ?: false,
            tokenValid = r["token_valid"]?.jsonPrimitive?.boolean ?: false,
        )
        PayCraftLogger.onRpcResult(
            "check_premium_with_device",
            "isPremium=${result.isPremium}, tokenValid=${result.tokenValid}",
        )
        return result
    }

    override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean {
        PayCraftLogger.onRpcCall(
            "transfer_to_device",
            "token=${serverToken.take(12)}..., newToken=${newDeviceToken.take(12)}...",
        )
        val r = postgrest.rpc(
            function = "transfer_to_device",
            parameters = buildJsonObject {
                put("p_server_token", serverToken)
                put("p_new_device_token", newDeviceToken)
                apiKey?.let { put("p_api_key", it) }
            },
        ).decodeAs<JsonObject>()
        val transferred = r["transferred"]?.jsonPrimitive?.boolean ?: false
        PayCraftLogger.onRpcResult("transfer_to_device", "transferred=$transferred, raw=$r")
        return transferred
    }

    override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean {
        PayCraftLogger.onRpcCall("revoke_device", "token=${serverToken.take(12)}...")
        val r = postgrest.rpc(
            function = "revoke_device",
            parameters = buildJsonObject {
                put("p_server_token", serverToken)
                put("p_target_token", targetToken)
                apiKey?.let { put("p_api_key", it) }
            },
        ).decodeAs<JsonObject>()
        return r["revoked"]?.jsonPrimitive?.boolean ?: false
    }

    override suspend fun checkOtpGate(): OtpGateResult {
        PayCraftLogger.onRpcCall("check_otp_gate", "")
        val r = postgrest.rpc("check_otp_gate").decodeAs<JsonObject>()
        return OtpGateResult(
            available = r["available"]?.jsonPrimitive?.boolean ?: false,
            sendsToday = r["sends_today"]?.jsonPrimitive?.int ?: 0,
            limit = r["limit"]?.jsonPrimitive?.int ?: 300,
        )
    }

    override suspend fun sendOtp(email: String) {
        auth.signInWith(OTP) { this.email = email }
    }

    override suspend fun verifyOtp(email: String, token: String): Boolean = try {
        auth.verifyEmailOtp(
            type = OtpType.Email.EMAIL,
            email = email,
            token = token,
        )
        true
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("verifyOtp", e.message)
        false
    }

    override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = try {
        PayCraftLogger.onRpcCall("verifyOAuthToken", provider.name)
        when (provider) {
            OAuthProvider.GOOGLE -> auth.signInWith(IDToken) {
                this.idToken = idToken
                this.provider = Google
            }
            OAuthProvider.APPLE -> auth.signInWith(IDToken) {
                this.idToken = idToken
                this.provider = Apple
            }
        }
        val email = auth.currentSessionOrNull()?.user?.email
        PayCraftLogger.onRpcResult("verifyOAuthToken", "email=${email ?: "null"}")
        email
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("verifyOAuthToken", e.message)
        null
    }

    override suspend fun getEntitlements(appUserId: String): EntitlementDto? = try {
        PayCraftLogger.onRpcCall("get_entitlements", "appUserId=${appUserId.take(12)}...")
        val dto = postgrest.rpc(
            function = "get_entitlements",
            parameters = buildJsonObject {
                put("p_app_user_id", appUserId)
                apiKey?.let { put("p_api_key", it) }
            },
        ).decodeList<EntitlementDto>().firstOrNull()
        PayCraftLogger.onRpcResult(
            "get_entitlements",
            if (dto != null) "state=${dto.canonicalState}, provider=${dto.provider}" else "null",
        )
        dto
    } catch (e: Exception) {
        // Deliberately RETHROW: the Store5 Fetcher must observe the network failure so its
        // SourceOfTruth serves the offline last-known-good (AC9). Swallowing to null here would
        // masquerade "offline" as "no entitlement" and wrongly revoke premium.
        PayCraftLogger.onRpcError("get_entitlements", e.message)
        throw e
    }

    override suspend fun cancelSubscription(provider: String, subscriptionId: String): Boolean = try {
        PayCraftLogger.onRpcCall("cancel_subscription", "provider=$provider, sub=${subscriptionId.take(12)}...")
        val result = postgrest.rpc(
            function = "cancel_subscription",
            parameters = buildJsonObject {
                put("p_provider", provider)
                put("p_subscription_id", subscriptionId)
                apiKey?.let { put("p_api_key", it) }
            },
        ).data
        val accepted = result.trim().toBooleanStrictOrNull() ?: false
        PayCraftLogger.onRpcResult("cancel_subscription", accepted.toString())
        accepted
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("cancel_subscription", e.message)
        false
    }

    /** Ktor client for edge-function POSTs (config/RPC use postgrest; edge functions are plain HTTP). */
    private val http: HttpClient by lazy {
        HttpClient {
            install(ContentNegotiation) {
                json(Json { ignoreUnknownKeys = true; explicitNulls = false; isLenient = true })
            }
        }
    }

    override suspend fun registerPlayPurchase(
        purchaseToken: String,
        productId: String,
        appUserId: String,
        packageName: String,
    ): EntitlementDto? = try {
        val backend = PayCraft.backend
        val url = "${backend.supabaseUrl}/functions/v1/register-play-purchase"
        PayCraftLogger.onRpcCall("register_play_purchase", "product=$productId, token=${purchaseToken.take(12)}...")
        val response: HttpResponse = http.post(url) {
            header("Authorization", "Bearer ${backend.supabaseAnonKey}")
            header("apikey", backend.supabaseAnonKey)
            contentType(ContentType.Application.Json)
            setBody(
                buildJsonObject {
                    put("purchase_token", purchaseToken)
                    put("product_id", productId)
                    put("app_user_id", appUserId)
                    put("package_name", packageName)
                    apiKey?.let { put("api_key", it) }
                },
            )
        }
        if (!response.status.isSuccess()) {
            PayCraftLogger.onRpcError("register_play_purchase", "HTTP ${response.status.value}: ${response.body<String>()}")
            return null
        }
        val decoded: RegisterPlayPurchaseResponse = response.body()
        PayCraftLogger.onRpcResult(
            "register_play_purchase",
            "state=${decoded.entitlement?.canonicalState ?: "null"}",
        )
        decoded.entitlement
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("register_play_purchase", e.message)
        null
    }
}

// ─── DTO → canonical domain mapper ────────────────────────────────────────────

/**
 * Map the epoch-millis wire [EntitlementDto] onto the canonical ISO-8601
 * [com.mobilebytelabs.paycraft.model.Entitlement] the SDK gates on. The DTO's
 * `canonical_state` string is normalized through [canonicalStateOf] so the grace = active /
 * retry = inactive rule (D6) has exactly one owner.
 */
@OptIn(ExperimentalTime::class)
fun EntitlementDto.toEntitlement(): Entitlement = Entitlement(
    userId = appUserId,
    provider = provider,
    product = productId,
    canonicalState = canonicalStateOf(canonicalState),
    expiresAt = expiresAt?.let { Instant.fromEpochMilliseconds(it).toString() },
    willRenew = willRenew,
    inGraceUntil = inGraceUntil?.let { Instant.fromEpochMilliseconds(it).toString() },
    isSandbox = isSandbox,
    subscriptionId = subscriptionId,
    latestEventTs = latestEventTs,
)

/** Single normalization point provider-string → canonical [SubscriptionState] (D6). */
fun canonicalStateOf(raw: String): SubscriptionState = when (raw.lowercase()) {
    "trial", "trialing" -> SubscriptionState.Trial
    "active" -> SubscriptionState.Active
    "active_non_renewing", "non_renewing" -> SubscriptionState.ActiveNonRenewing
    "in_grace_period", "grace" -> SubscriptionState.InGracePeriod
    "on_billing_retry", "on_hold", "billing_retry" -> SubscriptionState.OnBillingRetry
    "paused" -> SubscriptionState.Paused
    "expired" -> SubscriptionState.Expired
    "cancelled", "canceled" -> SubscriptionState.Cancelled
    "refunded" -> SubscriptionState.Refunded
    else -> SubscriptionState.Pending
}
