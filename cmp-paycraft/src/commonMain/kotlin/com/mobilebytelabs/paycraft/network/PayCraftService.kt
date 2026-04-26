package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.rpc
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
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

interface PayCraftService {
    suspend fun isPremium(email: String): Boolean
    suspend fun getSubscription(email: String): SubscriptionDto?
}

class PayCraftServiceImpl(private val postgrest: Postgrest) : PayCraftService {

    override suspend fun isPremium(email: String): Boolean = try {
        PayCraftLogger.onRpcCall("is_premium", email)
        val result = postgrest.rpc(
            function = "is_premium",
            parameters = buildJsonObject { put("user_email", email) },
        ).data
        val decoded = result.trim().toBooleanStrictOrNull() ?: false
        PayCraftLogger.onRpcResult("is_premium", decoded.toString())
        decoded
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("is_premium", e.message)
        false
    }

    override suspend fun getSubscription(email: String): SubscriptionDto? = try {
        PayCraftLogger.onRpcCall("get_subscription", email)
        val sub = postgrest.rpc(
            function = "get_subscription",
            parameters = buildJsonObject { put("user_email", email) },
        ).decodeList<SubscriptionDto>().firstOrNull()
        PayCraftLogger.onRpcResult(
            "get_subscription",
            if (sub !=
                null
            ) {
                "plan=${sub.plan}, status=${sub.status}"
            } else {
                "null"
            },
        )
        sub
    } catch (e: Exception) {
        PayCraftLogger.onRpcError("get_subscription", e.message)
        null
    }
}
