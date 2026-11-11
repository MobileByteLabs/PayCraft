package com.mobilebytelabs.paycraft.web

import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.MonetizationMode
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

/**
 * A device holding one of the subscription's seats ([PayCraftWeb.activeDevices]). [ref] is what
 * [PayCraftWeb.useThisDeviceInstead] takes to sign it out; [platform] is `android` · `ios` · `web` · `desktop`.
 */
/**
 * One way to pay for a plan on the web ([PayCraftWeb.paymentOptions]): the [provider] id to pass to
 * [PayCraftWeb.checkoutUrlWith], its display [name] and the [methods] it offers as one phrase ("UPI, cards,
 * netbanking & wallets") — and the same as a list ([methodList], in the order the provider shows them), the card
 * networks it takes ([cardBrands]) and a short [note]. It depends on the currency: Razorpay offers UPI only for INR.
 */
@JsExport
class WebPaymentOption(
    val provider: String,
    val name: String,
    val methods: String,
    val methodList: Array<String>,
    val cardBrands: Array<String>,
    val note: String?,
)

@JsExport
class WebDevice(
    val ref: String,
    val name: String?,
    val platform: String,
    val lastSeen: String?,
    /** True for this browser ([PayCraftWeb.devices]). */
    val thisDevice: Boolean,
    /** The subscription's seat count. */
    val maxDevices: Int,
)

/**
 * The buyer's current subscription (`get_subscription`): [plan] is the product sku, [status] one of
 * `active` · `trialing` · `past_due`, [renewsAt] the ISO end of the paid period (null for one-time
 * purchases), [cancelAtPeriodEnd] true when it will not renew.
 */
@JsExport
class WebSubscription(
    val plan: String?,
    val status: String?,
    val provider: String?,
    val renewsAt: String?,
    val cancelAtPeriodEnd: Boolean,
    val trialEndsAt: String?,
)

/** The tenant's exit survey ([PayCraftWeb.surveyConfig]): the question and the reasons, in order. */
@JsExport
class WebExitSurvey(val title: String, val reasons: Array<WebSurveyReason>)

/** One answer. [freeText]: "Something else" — show a text field and send what the buyer writes. */
@JsExport
class WebSurveyReason(val code: String, val label: String, val freeText: Boolean)

/**
 * A win-back discount for this buyer ([PayCraftWeb.answerSurvey]): [percentOff] off, for [duration] (`once` = the
 * first payment, `repeating` = [durationInMonths] months, `forever`), until [expiresAt] (ISO). [stripe] / [razorpay]:
 * the checkout lanes that can apply it. [PayCraftWeb.claimOffer] carries it into the next checkout.
 */
@JsExport
class WebOffer(
    val id: String,
    val percentOff: Int,
    val duration: String,
    val durationInMonths: Int?,
    val expiresAt: String,
    val stripe: Boolean,
    val razorpay: Boolean,
)

/** What an answer earned: [action] `offer` ([offer]), `message` ([message]) or `none` (close). */
@JsExport
class WebWinback(val action: String, val message: String?, val offer: WebOffer?)

/** Every failure the SDK rejects a promise with; [code] is stable (`sign_in_required`, `http_401`, …). */
@JsExport
class PayCraftWebError(val code: String, message: String) : Exception(message)

// ── Core config → exported shapes ────────────────────────────────────────────────────────────
// The config itself is decoded by cmp-paycraft-core (PayCraftContract.decodeConfig — the app's model);
// these only project it onto the plain classes a web page sees.

internal fun SuiteConfig.toWebConfig(): WebConfig = WebConfig(
    products = products.map { it.toWeb() }.toTypedArray(),
    providers = providers.map { it.provider }.toTypedArray(),
    googleClientId = auth?.googleWebClientId,
    appleServicesId = auth?.appleServicesId,
    mode = when (mode) {
        MonetizationMode.AdSupported -> "ad_supported"
        MonetizationMode.TrialManaged -> "trial_managed"
        null -> null
    },
)

internal fun ProductDto.toWeb(): WebProduct = WebProduct(
    sku = sku,
    name = displayName.ifBlank { sku },
    type = type.ifBlank { null },
    interval = interval,
    amountCents = resolvedPrice?.amountCents ?: basePriceCents,
    currency = resolvedPrice?.currency ?: baseCurrency,
    trialDays = if (trialEnabled) trialDurationDays else null,
)

// ── Web-only response shapes (no core equivalent) ──────────────────────────────────────────────

@Serializable
internal class SubscriptionWire(
    val plan: String? = null,
    val status: String? = null,
    val provider: String? = null,
    @SerialName("current_period_end") val currentPeriodEnd: String? = null,
    @SerialName("cancel_at_period_end") val cancelAtPeriodEnd: Boolean? = null,
    @SerialName("trial_end") val trialEnd: String? = null,
)

@Serializable
internal class CheckoutWire(val url: String? = null)

@Serializable
internal class ErrorWire(val error: String? = null, val message: String? = null)
