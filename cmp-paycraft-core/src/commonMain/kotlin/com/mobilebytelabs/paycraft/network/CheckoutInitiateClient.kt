package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.contract.PayCraftContract
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
 * Client for `POST /functions/v1/checkout-initiate` — the per-customer checkout lane.
 *
 * WHY A SERVER ROUND-TRIP INSTEAD OF A URL THE SDK BUILDS ITSELF
 * Some checkouts cannot be addressed by a static link. A Razorpay recurring plan is the case that
 * forced this: an auth link authorises ONE customer's mandate, so it carries their contact, and no
 * reusable product-level link exists. The SDK cannot mint one, and it must never hold the merchant
 * secret that could. So the server does it and hands back a `short_url`.
 *
 * Until this existed the SDK had only the static-link path, fell through it for every subscription
 * bound to a PSP plan, and the paywall's Continue button failed with "no checkout URL for currency
 * INR" while the plan id sat right there in the config.
 */
class CheckoutInitiateClient(private val httpClient: HttpClient, private val backend: PayCraftBackend) {

    @Serializable
    private data class CustomerBody(val email: String, val name: String? = null, val phone: String? = null)

    @Serializable
    private data class InitiateRequest(
        val sku: String,
        val customer: CustomerBody,
        val currency: String? = null,
        /** A win-back offer the buyer claimed (exit survey); the server validates it is theirs and live. */
        val offerId: String? = null,
        /** The device the offer may have been made to (signed-out buyers' offers bind to the device). */
        val deviceRef: String? = null,
    )

    @Serializable
    private data class InitiateResponse(
        val url: String,
        val provider: String? = null,
        val currency: String? = null,
        @SerialName("subscription_id") val subscriptionId: String? = null,
    )

    @Serializable
    private data class ErrorBody(val error: String? = null)

    sealed class Result {
        /** [url] is the customer-facing page to open — a mandate authorisation, not a receipt. */
        data class Ok(val url: String, val provider: String?, val subscriptionId: String?) : Result()

        /** The request was understood and refused; [message] is safe to show a buyer-facing surface. */
        data class Rejected(val message: String) : Result()

        data class Error(val message: String) : Result()
    }

    suspend fun initiate(
        apiKey: String,
        sku: String,
        email: String,
        name: String? = null,
        phone: String? = null,
        currency: String? = null,
    ): Result = initiateWithOffer(apiKey, sku, email, name, phone, currency, offerId = null, deviceRef = null)

    /**
     * [initiate] with a claimed win-back [offerId]: the server applies its discount, or answers 409
     * `offer_not_usable` (→ [Result.Rejected] carrying that code) when it is not this buyer's or has ended.
     */
    suspend fun initiateWithOffer(
        apiKey: String,
        sku: String,
        email: String,
        name: String? = null,
        phone: String? = null,
        currency: String? = null,
        offerId: String?,
        deviceRef: String?,
    ): Result {
        val url = PayCraftContract.checkoutInitiateUrl(backend.supabaseUrl, apiKey)
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(
                    InitiateRequest(
                        sku = sku,
                        customer = CustomerBody(email = email, name = name, phone = phone),
                        currency = currency,
                        offerId = offerId,
                        deviceRef = deviceRef,
                    ),
                )
            }
            when (response.status) {
                HttpStatusCode.OK -> {
                    val body = response.body<InitiateResponse>()
                    if (body.url.isBlank()) {
                        Result.Error("Checkout service returned no URL")
                    } else {
                        Result.Ok(body.url, body.provider, body.subscriptionId)
                    }
                }
                HttpStatusCode.Unauthorized -> Result.Error("Invalid API key")
                HttpStatusCode.TooManyRequests ->
                    Result.Rejected("Too many checkout attempts — try again in a minute")
                // 409 is the server saying the request was understood and cannot be served as asked
                // (no plan for this currency, provider not connected, product is not a subscription).
                // Those messages are written for a human and are worth passing through verbatim.
                HttpStatusCode.Conflict, HttpStatusCode.BadRequest, HttpStatusCode.NotFound -> {
                    Result.Rejected(errorOf(response.bodyAsText()) ?: "Checkout is not available for this plan")
                }
                else -> Result.Error(
                    errorOf(response.bodyAsText()) ?: "Checkout failed (HTTP ${response.status.value})",
                )
            }
        } catch (e: Throwable) {
            Result.Error(e.message ?: "Network error")
        }
    }

    private fun errorOf(text: String): String? =
        runCatching { Json { ignoreUnknownKeys = true }.decodeFromString<ErrorBody>(text) }
            .getOrNull()
            ?.error
}
