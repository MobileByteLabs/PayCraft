package com.mobilebytelabs.paycraft.web

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// ── Public (exported to JavaScript / TypeScript) ─────────────────────────────────────────────

/** A purchasable product as the tenant's `/config` serves it for this visitor's country. */
@JsExport
class WebProduct(
    val sku: String,
    val name: String,
    val type: String?,
    val interval: String?,
    /** Price in minor units (paise, cents) for [currency]. */
    val amountCents: Int,
    val currency: String,
    val trialDays: Int?,
)

/** What a website needs from the tenant config: products, checkout providers (primary first), sign-in client ids. */
@JsExport
class WebConfig(
    val products: Array<WebProduct>,
    val providers: Array<String>,
    val googleClientId: String?,
    val appleServicesId: String?,
    /** `ad_supported` | `trial_managed` | null — the dashboard's monetization mode. */
    val mode: String?,
)

/** Premium status for the signed-in buyer. Same meaning as the mobile SDK: premium ⇒ ad-free. */
@JsExport
class PremiumState(val isPremium: Boolean, val tokenValid: Boolean, val email: String?)

/**
 * Result of signing in. [conflict] means the account is already active on another device
 * ([conflictingDeviceName]); call `useThisDevice()` to move it here, as the mobile app does.
 */
@JsExport
class SignInResult(val email: String, val conflict: Boolean, val conflictingDeviceName: String?)

/** Every failure the SDK rejects a promise with; [code] is stable (`sign_in_required`, `http_401`, …). */
@JsExport
class PayCraftWebError(val code: String, message: String) : Exception(message)

// ── Wire shapes (internal; names follow the server, unknown keys ignored) ─────────────────────

@Serializable
internal class ConfigWire(
    val products: List<ProductWire> = emptyList(),
    val providers: List<ProviderWire> = emptyList(),
    val mode: String? = null,
    val auth: AuthWire? = null,
)

@Serializable
internal class ProductWire(
    val sku: String,
    val type: String? = null,
    @SerialName("display_name") val displayName: String = "",
    val interval: String? = null,
    @SerialName("base_price_cents") val basePriceCents: Int = 0,
    @SerialName("base_currency") val baseCurrency: String = "USD",
    @SerialName("trial_enabled") val trialEnabled: Boolean = true,
    @SerialName("trial_duration_days") val trialDurationDays: Int? = null,
    @SerialName("resolved_price") val resolvedPrice: PriceWire? = null,
    @SerialName("store_binding") val storeBinding: StoreBindingWire? = null,
)

@Serializable
internal class StoreBindingWire(val provider: String? = null)

@Serializable
internal class PriceWire(@SerialName("amount_cents") val amountCents: Int? = null, val currency: String? = null)

@Serializable
internal class ProviderWire(
    val provider: String,
    @SerialName("test_payment_links") val testPaymentLinks: Map<String, Map<String, String>>? = null,
    @SerialName("live_payment_links") val livePaymentLinks: Map<String, Map<String, String>>? = null,
)

@Serializable
internal class AuthWire(
    @SerialName("google_web_client_id") val googleWebClientId: String? = null,
    @SerialName("apple_services_id") val appleServicesId: String? = null,
)

@Serializable
internal class VerifyWire(val email: String? = null, val provider: String? = null)

@Serializable
internal class RegisterWire(
    @SerialName("server_token") val serverToken: String? = null,
    val conflict: Boolean = false,
    @SerialName("conflicting_device_name") val conflictingDeviceName: String? = null,
)

@Serializable
internal class PremiumWire(
    @SerialName("is_premium") val isPremium: Boolean = false,
    @SerialName("token_valid") val tokenValid: Boolean = false,
    val email: String? = null,
)

@Serializable
internal class TransferWire(val transferred: Boolean = false)

@Serializable
internal class CheckoutWire(val url: String? = null)

@Serializable
internal class ErrorWire(val error: String? = null, val message: String? = null)

internal fun ProductWire.toWeb(): WebProduct = WebProduct(
    sku = sku,
    name = displayName.ifBlank { sku },
    type = type,
    interval = interval,
    amountCents = resolvedPrice?.amountCents ?: basePriceCents,
    currency = resolvedPrice?.currency ?: baseCurrency,
    trialDays = if (trialEnabled) trialDurationDays else null,
)
