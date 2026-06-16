package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.CouponDto
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Client for the `/functions/v1/coupon-validate` edge function.
 *
 * The customer types a code into the paywall; the SDK calls [validate] which hits
 * the cloud + returns either a [CouponDto] (success) or a typed error. The SDK
 * then re-renders the paywall with the discounted price, and at checkout time
 * the resolved [CouponDto.stripePromotionCodeId] (or equivalent) is appended to
 * the provider's checkout URL.
 */
class CouponClient(
    private val httpClient: HttpClient,
    private val backend: PayCraftBackend,
) {

    @Serializable
    private data class ValidateRequest(
        val apiKey: String,
        val code: String,
        @SerialName("product_id") val productId: String,
    )

    @Serializable
    private data class ErrorBody(val error: String? = null)

    sealed class Result {
        data class Ok(val coupon: CouponDto) : Result()
        data class Invalid(val message: String) : Result()
        data class Error(val message: String) : Result()
    }

    suspend fun validate(apiKey: String, code: String, productId: String): Result {
        val url = "${backend.supabaseUrl}/functions/v1/coupon-validate"
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(ValidateRequest(apiKey = apiKey, code = code.trim().uppercase(), productId = productId))
            }
            when (response.status) {
                HttpStatusCode.OK -> Result.Ok(response.body<CouponDto>())
                HttpStatusCode.NotFound -> Result.Invalid("Coupon code not recognized")
                HttpStatusCode.Unauthorized -> Result.Error("Invalid API key")
                HttpStatusCode.TooManyRequests -> Result.Error("Too many attempts — try again in a minute")
                else -> {
                    val txt = response.bodyAsText()
                    val parsed = runCatching { Json.decodeFromString<ErrorBody>(txt) }.getOrNull()
                    Result.Error(parsed?.error ?: "Validation failed (HTTP ${response.status.value})")
                }
            }
        } catch (e: Throwable) {
            Result.Error(e.message ?: "Network error")
        }
    }
}
