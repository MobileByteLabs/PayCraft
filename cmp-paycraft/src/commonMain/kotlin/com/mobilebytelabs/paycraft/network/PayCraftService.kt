package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.OAuthProvider
import io.github.jan.supabase.SupabaseClient
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
    // Legacy
    suspend fun isPremium(email: String, mode: String = "live"): Boolean
    suspend fun getSubscription(email: String, mode: String = "live"): SubscriptionDto?

    // Device-binding RPCs
    suspend fun registerDevice(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String = "live",
    ): RegisterDeviceResult

    suspend fun checkPremiumWithDevice(email: String, deviceToken: String, mode: String = "live"): PremiumCheckResult

    suspend fun transferToDevice(email: String, newToken: String, mode: String = "live"): Boolean

    suspend fun revokeDevice(email: String, deviceToken: String, mode: String = "live"): Boolean

    suspend fun checkOtpGate(): OtpGateResult

    // OTP ownership verification
    suspend fun sendOtp(email: String)
    suspend fun verifyOtp(email: String, token: String): Boolean

    /**
     * Verifies a Google or Apple ID token via Supabase Auth (Gate 1).
     * Returns the verified email address, or null if verification fails.
     */
    suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String?
}

// ─── Implementation ───────────────────────────────────────────────────────────

class PayCraftServiceImpl(private val client: SupabaseClient) : PayCraftService {

    private val postgrest get() = client.postgrest
    private val auth get() = client.auth

    override suspend fun isPremium(email: String, mode: String): Boolean = try {
        PayCraftLogger.onRpcCall("is_premium", email)
        val result = postgrest.rpc(
            function = "is_premium",
            parameters = buildJsonObject {
                put("user_email", email)
                put("stripe_mode", mode)
            },
        ).data
        val decoded = result.trim().toBooleanStrictOrNull() ?: false
        PayCraftLogger.onRpcResult("is_premium", decoded.toString())
        decoded
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("is_premium", e.message)
        false
    }

    override suspend fun getSubscription(email: String, mode: String): SubscriptionDto? = try {
        PayCraftLogger.onRpcCall("get_subscription", email)
        val sub = postgrest.rpc(
            function = "get_subscription",
            parameters = buildJsonObject {
                put("user_email", email)
                put("stripe_mode", mode)
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

    override suspend fun registerDevice(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String,
    ): RegisterDeviceResult {
        PayCraftLogger.onRpcCall(
            "register_device",
            "$email (platform=$platform, device=$deviceName, id=$deviceId, mode=$mode)",
        )
        val r = postgrest.rpc(
            function = "register_device",
            parameters = buildJsonObject {
                put("p_email", email)
                put("p_platform", platform)
                put("p_device_name", deviceName)
                put("p_device_id", deviceId)
                put("p_mode", mode)
            },
        ).decodeAs<JsonObject>()
        val result = RegisterDeviceResult(
            deviceToken = r["device_token"]!!.jsonPrimitive.content,
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

    override suspend fun checkPremiumWithDevice(email: String, deviceToken: String, mode: String): PremiumCheckResult {
        PayCraftLogger.onRpcCall("check_premium_with_device", "$email (token=${deviceToken.take(20)}, mode=$mode)")
        val r = postgrest.rpc(
            function = "check_premium_with_device",
            parameters = buildJsonObject {
                put("p_email", email)
                put("p_device_token", deviceToken)
                put("p_mode", mode)
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

    override suspend fun transferToDevice(email: String, newToken: String, mode: String): Boolean {
        PayCraftLogger.onRpcCall("transfer_to_device", "$email (newToken=${newToken.take(20)}, mode=$mode)")
        val r = postgrest.rpc(
            function = "transfer_to_device",
            parameters = buildJsonObject {
                put("p_email", email)
                put("p_new_token", newToken)
                put("p_mode", mode)
            },
        ).decodeAs<JsonObject>()
        val transferred = r["transferred"]?.jsonPrimitive?.boolean ?: false
        PayCraftLogger.onRpcResult("transfer_to_device", "transferred=$transferred, raw=$r")
        return transferred
    }

    override suspend fun revokeDevice(email: String, deviceToken: String, mode: String): Boolean {
        PayCraftLogger.onRpcCall("revoke_device", email)
        val r = postgrest.rpc(
            function = "revoke_device",
            parameters = buildJsonObject {
                put("p_email", email)
                put("p_device_token", deviceToken)
                put("p_mode", mode)
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
}
