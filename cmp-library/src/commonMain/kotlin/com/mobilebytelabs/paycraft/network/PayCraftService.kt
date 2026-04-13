package com.mobilebytelabs.paycraft.network

import co.touchlab.kermit.Logger
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.rpc
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

private const val TAG = "PayCraftService"

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

class PayCraftServiceImpl(
    private val postgrest: Postgrest,
) : PayCraftService {

    override suspend fun isPremium(email: String): Boolean {
        return try {
            Logger.d(TAG) { "Checking premium for: $email" }
            val result = postgrest.rpc(
                function = "is_premium",
                parameters = buildJsonObject { put("user_email", email) },
            ).data
            val decoded = result.trim().toBooleanStrictOrNull() ?: false
            Logger.d(TAG) { "Premium result for $email: $decoded" }
            decoded
        } catch (e: Exception) {
            Logger.e(TAG) { "Failed to check premium: ${e.message}" }
            false
        }
    }

    override suspend fun getSubscription(email: String): SubscriptionDto? {
        return try {
            postgrest.rpc(
                function = "get_subscription",
                parameters = buildJsonObject { put("user_email", email) },
            ).decodeList<SubscriptionDto>().firstOrNull()
        } catch (e: Exception) {
            Logger.e(TAG) { "Failed to get subscription: ${e.message}" }
            null
        }
    }
}
