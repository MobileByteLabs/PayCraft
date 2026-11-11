package com.mobilebytelabs.paycraft.contract

import com.mobilebytelabs.paycraft.CurrencyResolver
import com.mobilebytelabs.paycraft.PayCraftInternalApi
import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.config.AuthClientsDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.network.ActiveDevice
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.winback.AppStorePromotionalOffer
import com.mobilebytelabs.paycraft.winback.ExitSurveyConfig
import com.mobilebytelabs.paycraft.winback.WinbackOffer
import com.mobilebytelabs.paycraft.winback.WinbackResult
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * PayCraft's wire contract — the ONE definition of what goes over the network, shared by the app SDK
 * (this module's Ktor/supabase clients) and the browser SDK (`cmp-paycraft-web`, which moves the same
 * bytes with `fetch`). URLs, headers, request bodies, response parsing and the web checkout routing
 * live here so the two SDKs cannot drift (paycraft-core-split, GOAL Background).
 *
 * Pure Kotlin: no Ktor, no supabase-kt, no platform code — so a JS bundle that reaches it pays for
 * kotlinx-serialization only.
 */
@PayCraftInternalApi
object PayCraftContract {

    /** Decoding policy for `/config`: unknown keys ignored, explicit nulls fall back to defaults. */
    val configJson: Json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        coerceInputValues = true
    }

    // ── URLs ────────────────────────────────────────────────────────────────────────────────

    fun configUrl(base: String, apiKey: String): String =
        "$base/functions/v1/config?apiKey=${encodeUrlComponent(apiKey)}"

    fun identityVerifyUrl(base: String): String = "$base/functions/v1/identity-token/verify"

    fun checkoutInitiateUrl(base: String, apiKey: String): String =
        "$base/functions/v1/checkout-initiate?apiKey=${encodeUrlComponent(apiKey)}"

    fun rpcUrl(base: String, function: String): String = "$base/rest/v1/rpc/$function"

    /** Exit-survey answers → win-back decision (GOAL D3/D6). */
    fun winbackUrl(base: String, apiKey: String): String =
        "$base/functions/v1/winback?apiKey=${encodeUrlComponent(apiKey)}"

    /** Paywall events ingest (GOAL D1) — the first-party funnel. */
    fun eventsUrl(base: String, apiKey: String): String =
        "$base/functions/v1/events?apiKey=${encodeUrlComponent(apiKey)}"

    // ── Headers ─────────────────────────────────────────────────────────────────────────────

    /**
     * Headers every PayCraft call carries: the backend's public anon key (twice — Supabase reads both),
     * the caller platform (`/config` resolves per-platform provider order and store bindings from it)
     * and the test/live mode (link selection only, never authorisation).
     */
    fun headers(anonKey: String, platform: String, mode: String, json: Boolean): Map<String, String> = buildMap {
        put("apikey", anonKey)
        put("Authorization", "Bearer $anonKey")
        put("x-paycraft-platform", platform)
        put("x-paycraft-mode", mode)
        if (json) put("content-type", "application/json")
    }

    // ── Config ──────────────────────────────────────────────────────────────────────────────

    fun decodeConfig(raw: String): SuiteConfig = configJson.decodeFromString(SuiteConfig.serializer(), raw)

    /**
     * `/config` as a WEBSITE needs it: products, providers, sign-in client ids and the mode — decoded with the
     * app's model, but tolerant where the app can afford to be strict. The app has a config cache and a bundled
     * fallback; a web page has neither, so one bad field must not take checkout down with it:
     *  - `paywall` / `offerings` (paywall UI, partly tenant-written JSONB) are not decoded at all;
     *  - a product or provider that fails to decode is skipped, not fatal; a product whose `resolved_price` is
     *    malformed keeps its base price;
     *  - a missing `tenant_id` is tolerated, and a product missing `id` / `type` / `display_name` gets "".
     * Throws only when the body is not a JSON object.
     */
    fun decodeConfigForWeb(raw: String): SuiteConfig {
        val root = configJson.parseToJsonElement(raw).jsonObject
        val slim = buildJsonObject {
            put("tenant_id", root["tenant_id"]?.jsonPrimitive?.contentOrNull.orEmpty())
            root["mode"]?.let { put("mode", it) }
            root["locale"]?.let { put("locale", it) }
        }
        val base = configJson.decodeFromJsonElement(SuiteConfig.serializer(), slim)
        val products = root.array("products").mapNotNull { element ->
            val o = (element as? JsonObject)?.withProductDefaults() ?: return@mapNotNull null
            decodeOrNull(ProductDto.serializer(), o)
                ?: decodeOrNull(ProductDto.serializer(), JsonObject(o - "resolved_price"))
        }
        val providers = root.array("providers").mapNotNull { decodeOrNull(ProviderDto.serializer(), it) }
        val auth = root["auth"]?.let { decodeOrNull(AuthClientsDto.serializer(), it) }
        return base.copy(products = products, providers = providers, auth = auth)
    }

    private fun <T> decodeOrNull(serializer: KSerializer<T>, element: JsonElement): T? =
        runCatching { configJson.decodeFromJsonElement(serializer, element) }.getOrNull()

    private fun JsonObject.array(key: String): List<JsonElement> = (this[key] as? JsonArray).orEmpty()

    /** The web never needed `id` / `type` / `display_name`; absent ones become "" instead of failing the product. */
    private fun JsonObject.withProductDefaults(): JsonObject = JsonObject(
        mapOf("id" to JsonPrimitive(""), "type" to JsonPrimitive(""), "display_name" to JsonPrimitive("")) + this,
    )

    // ── Identity ────────────────────────────────────────────────────────────────────────────

    /** `identity-token/verify` body. Apple's `nonce` is the RAW value (the server hashes it). */
    fun identityVerifyBody(apiKey: String?, provider: String, idToken: String, nonce: String?): JsonObject =
        buildJsonObject {
            put("api_key", apiKey.orEmpty())
            put("provider", provider)
            put("id_token", idToken)
            if (nonce != null) put("nonce", nonce)
        }

    // ── Exit survey / win-back ──────────────────────────────────────────────────────────────

    /** The `exit_survey` section of a `/config` response; null when absent or malformed (no survey, never a crash). */
    fun decodeExitSurvey(raw: String): ExitSurveyConfig? = runCatching {
        // Read by hand, like decodeWinback: generated serializers for these four classes would cost the web SDK
        // ~3 KB gzip of its 150 KB budget (paycraft-paywall-analytics T14). A wrong type anywhere → no survey.
        val s = configJson.parseToJsonElement(raw).jsonObject["exit_survey"] as? JsonObject ?: return null
        ExitSurveyConfig(
            enabled = s["enabled"]?.jsonPrimitive?.let { it.booleanOrNull ?: error("enabled") } ?: false,
            title = s.string("title").orEmpty(),
            reasons = (s["reasons"] as? JsonArray).orEmpty().map { e ->
                val r = e.jsonObject
                ExitSurveyConfig.Reason(
                    code = r.string("code")!!,
                    label = r.string("label")!!,
                    action = r.string("action") ?: "none",
                    message = r.string("message"),
                    freeText = r.bool("free_text") ?: false,
                    offer = (r["offer"] as? JsonObject)?.let {
                        ExitSurveyConfig.Offer(
                            percentOff = it["percent_off"]!!.jsonPrimitive.intOrNull!!,
                            duration = it.string("duration") ?: "once",
                            durationInMonths = it["duration_in_months"]?.jsonPrimitive?.intOrNull,
                        )
                    },
                )
            },
            capDays = s["cap_days"]?.jsonPrimitive?.intOrNull ?: 7,
        )
    }.getOrNull()

    /**
     * `winback` body: the buyer's answer. The buyer is the device token's account (resolved server-side to a
     * hash); [freeText] is sent only for a reason that asks for it and is stored first-party only.
     */
    fun winbackBody(
        apiKey: String,
        deviceRef: String,
        deviceToken: String?,
        reasonCode: String,
        step: String,
        platform: String,
        sku: String?,
        freeText: String?,
    ): JsonObject = buildJsonObject {
        put("apiKey", apiKey)
        put("deviceRef", deviceRef)
        if (deviceToken != null) put("deviceToken", deviceToken)
        put("reasonCode", reasonCode)
        put("step", step)
        put("platform", platform)
        if (sku != null) put("sku", sku)
        if (!freeText.isNullOrBlank()) put("freeText", freeText.take(500))
    }

    /** The `winback` answer; anything unreadable is [WinbackResult.None] (close the survey, never crash). */
    fun decodeWinback(raw: String, sku: String?): WinbackResult = decodeWinbackWith(raw, sku, ::appStoreLane)

    /**
     * [decodeWinback] for the web SDK: the same answer without the App Store lane, which a website cannot apply —
     * so the promotional-offer signature parsing stays out of the web bundle (its 150 KB budget, GOAL D5).
     */
    fun decodeWinbackForWeb(raw: String, sku: String?): WinbackResult = decodeWinbackWith(raw, sku) { null }

    private inline fun decodeWinbackWith(
        raw: String,
        sku: String?,
        appStore: (JsonObject) -> AppStorePromotionalOffer?,
    ): WinbackResult = runCatching {
        val o = configJson.parseToJsonElement(raw).jsonObject
        when (o.string("action")) {
            "message" -> o.string("message")?.let { WinbackResult.Message(it) } ?: WinbackResult.None
            "offer" -> {
                val offer = o["offer"]!!.jsonObject
                val lanes = offer["lanes"] as? JsonObject
                val store = lanes?.get("app_store") as? JsonObject
                WinbackResult.Offer(
                    WinbackOffer(
                        id = offer.string("id")!!,
                        percentOff = offer["percentOff"]!!.jsonPrimitive.intOrNull!!,
                        duration = offer.string("duration") ?: "once",
                        durationInMonths = offer["durationInMonths"]?.jsonPrimitive?.intOrNull,
                        expiresAtIso = offer.string("expiresAt").orEmpty(),
                        sku = sku,
                        stripe = lanes?.get("stripe")?.jsonPrimitive?.booleanOrNull == true,
                        razorpay = lanes?.get("razorpay")?.jsonPrimitive?.booleanOrNull == true,
                        googlePlayOfferId = (lanes?.get("google_play") as? JsonPrimitive)?.contentOrNull,
                        appStoreOffer = store?.let(appStore),
                    ),
                )
            }
            else -> WinbackResult.None
        }
    }.getOrDefault(WinbackResult.None)

    private fun appStoreLane(it: JsonObject) = AppStorePromotionalOffer(
        offerId = it.string("offerId")!!,
        keyIdentifier = it.string("keyIdentifier")!!,
        nonce = it.string("nonce")!!,
        signature = it.string("signature")!!,
        timestamp = it["timestamp"]!!.jsonPrimitive.content.toLong(),
    )

    // ── Paywall events ──────────────────────────────────────────────────────────────────────

    /**
     * `events` body: a batch of catalog events from one device. No personal data travels (GOAL D10) — the
     * buyer is resolved server-side from [deviceToken] to a hashed reference, and the visitor's country is
     * stamped by the server from the request, not trusted from [PayCraftEvent.country].
     */
    fun eventsBody(apiKey: String, deviceRef: String, deviceToken: String?, events: List<PayCraftEvent>): JsonObject =
        buildJsonObject {
            put("apiKey", apiKey)
            put("deviceRef", deviceRef)
            if (deviceToken != null) put("deviceToken", deviceToken)
            put(
                "events",
                JsonArray(
                    events.map { e ->
                        buildJsonObject {
                            put("name", e.name.wire)
                            put("step", e.step.wire)
                            put("platform", e.platform)
                            e.trigger?.let { put("trigger", it) }
                            e.sku?.let { put("sku", it) }
                            e.currency?.let { put("currency", it) }
                            e.provider?.let { put("provider", it) }
                            e.reason?.let { put("reason", it) }
                            put("at", e.atMs)
                        }
                    },
                ),
            )
        }

    /** The verified email from a `verify` response, or null when the provider gave none. */
    fun parseVerifiedEmail(o: JsonObject): String? = o.string("email")?.takeIf { it.isNotBlank() }

    // ── Device RPCs ─────────────────────────────────────────────────────────────────────────

    fun registerDeviceParams(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String,
        apiKey: String?,
    ): JsonObject = buildJsonObject {
        put("p_email", email)
        put("p_platform", platform)
        put("p_device_name", deviceName)
        put("p_device_id", deviceId)
        put("p_mode", mode)
        apiKey?.let { put("p_api_key", it) }
    }

    /** `register_device` result, or null when the server issued no token. */
    fun parseRegister(o: JsonObject): RegisterDeviceResult? {
        val token = o.string("server_token")?.takeIf { it.isNotBlank() } ?: return null
        return RegisterDeviceResult(
            deviceToken = token,
            conflict = o.bool("conflict") ?: false,
            conflictingDeviceName = o.string("conflicting_device_name"),
            conflictingLastSeen = o.string("conflicting_last_seen"),
            activeDevices = parseDevices(o["active_devices"] as? JsonArray),
            maxDevices = o["max_devices"]?.jsonPrimitive?.intOrNull ?: 1,
        )
    }

    /** `check_premium_with_device` / `get_subscription` params: the device token (+ the key). */
    /** `active_devices` (register conflict) / `get_active_devices`: rows without a device_ref are skipped. */
    fun parseDevices(a: JsonArray?): List<ActiveDevice> = a.orEmpty().mapNotNull { e ->
        val d = e as? JsonObject ?: return@mapNotNull null
        val ref = d.string("device_ref") ?: return@mapNotNull null
        ActiveDevice(
            ref = ref,
            name = d.string("device_name"),
            platform = d.string("platform") ?: "unknown",
            lastSeen = d.string("last_seen_at") ?: d.string("registered_at"),
            thisDevice = d.bool("this_device") ?: false,
            maxDevices = d["max_devices"]?.jsonPrimitive?.intOrNull ?: 1,
        )
    }

    fun signOutDeviceParams(serverToken: String, deviceRef: String, apiKey: String?): JsonObject = buildJsonObject {
        put("p_server_token", serverToken)
        put("p_device_ref", deviceRef)
        apiKey?.let { put("p_api_key", it) }
    }

    fun parseSignedOut(o: JsonObject): Boolean = o.bool("signed_out") ?: false

    fun tokenParams(serverToken: String, apiKey: String?): JsonObject = buildJsonObject {
        put("p_server_token", serverToken)
        apiKey?.let { put("p_api_key", it) }
    }

    fun parsePremium(o: JsonObject): PremiumCheckResult = PremiumCheckResult(
        isPremium = o.bool("is_premium") ?: false,
        tokenValid = o.bool("token_valid") ?: false,
        boundEmail = o.string("email"),
    )

    fun transferParams(
        serverToken: String,
        newDeviceToken: String,
        apiKey: String?,
        replaceDevice: String? = null,
    ): JsonObject = buildJsonObject {
        put("p_server_token", serverToken)
        put("p_new_device_token", newDeviceToken)
        apiKey?.let { put("p_api_key", it) }
        // Only sent when chosen: a pre-178 server has no such parameter and would reject the call.
        replaceDevice?.let { put("p_replace_device", it) }
    }

    fun parseTransferred(o: JsonObject): Boolean = o.bool("transferred") ?: false

    // ── Checkout ────────────────────────────────────────────────────────────────────────────

    /** The non-blank payment links `{currency: url}` [provider] has for [sku] in this mode. */
    fun paymentLinks(cfg: SuiteConfig?, provider: String, sku: String, test: Boolean): Map<String, String> {
        val dto = cfg?.providers?.firstOrNull { it.provider == provider } ?: return emptyMap()
        val bySku = if (test) dto.testPaymentLinksBySku else dto.livePaymentLinksBySku
        return bySku[sku].orEmpty().filterValues { it.isNotBlank() }
    }

    /**
     * Where a WEB buyer pays for [sku]. Nothing here is decided by a rule in code — the tenant's data
     * decides, in this order:
     *
     *  1. REGION → CURRENCY. `/config` prices the buyer for their country (`resolved_price`); that is the
     *     currency they saw, unless the caller asks for another.
     *  2. CURRENCY → PROVIDER. `/config` walks the tenant's routing rules for this platform and binds the
     *     product to the first provider that can actually charge that currency (a Stripe price / Razorpay
     *     plan id for it) — `store_binding`. Its method name (`stripe_card`, `razorpay_upi`, …) names the
     *     provider before the first `_`. With no web binding, a provider holding a payment link sells (one in
     *     that currency first); with neither, checkout is unavailable rather than guessed.
     *  3. HOW. That provider's payment link for the currency and mode when there is one (Stripe links get
     *     the buyer's email prefilled); otherwise `checkout-initiate` mints a per-customer page — a Razorpay
     *     subscription or a Stripe Checkout Session.
     */
    fun routeWebCheckout(
        cfg: SuiteConfig,
        sku: String,
        test: Boolean,
        requestedCurrency: String?,
        email: String,
        preferredProvider: String? = null,
        chargeable: Map<String, Set<String>> = emptyMap(),
    ): WebCheckoutRoute {
        val product = cfg.products.firstOrNull { it.sku == sku }
            ?: return WebCheckoutRoute.Unavailable(
                WebCheckoutFailure.UnknownSku,
                "No product $sku in this tenant's config",
            )
        val shown = (requestedCurrency ?: product.resolvedPrice?.currency ?: product.baseCurrency).uppercase()
        // The binding /config resolved for the currency the buyer saw; a caller asking for another
        // currency re-decides from the links below instead of reusing it.
        val bound = product.storeBinding?.provider
            ?.takeUnless { it in NATIVE_STORES }
            ?.takeIf { requestedCurrency == null || requestedCurrency.equals(product.resolvedPrice?.currency, true) }
            ?.let(::webProvider)
        val linked = cfg.providers.map { it.provider }.filter {
            it in WEB_PROVIDERS &&
                paymentLinks(cfg, it, sku, test).isNotEmpty()
        }
        // The buyer's own choice (the web's "Choose how to pay"), only when that provider can charge this
        // currency — a choice that cannot is ignored, never forced.
        val chosen = preferredProvider?.takeIf {
            it in webPaymentOptions(cfg, sku, test, requestedCurrency, chargeable)
        }
        val provider = chosen
            ?: bound
            ?: linked.firstOrNull { p -> paymentLinks(cfg, p, sku, test).keys.any { it.equals(shown, true) } }
            // a provider holding a price/plan in this currency (server checkout mints the page)
            ?: webPaymentOptions(cfg, sku, test, requestedCurrency, chargeable).firstOrNull()
            ?: linked.firstOrNull() // a link in another currency ([CurrencyResolver.checkoutCurrency] picks it)
            ?: return WebCheckoutRoute.Unavailable(
                WebCheckoutFailure.NoWebProvider,
                "No payment provider can charge $shown for $sku on the web",
            )
        val links = paymentLinks(cfg, provider, sku, test)
        if (links.isNotEmpty()) {
            val link = links.getValue(CurrencyResolver.checkoutCurrency(shown, links.keys))
            val url = if (provider == "stripe") withEmailParam(link, "prefilled_email", email) else link
            return WebCheckoutRoute.PaymentLink(provider, url)
        }
        return WebCheckoutRoute.ServerCheckout(shown, provider)
    }

    /** `url` with `param=email` appended (`?` or `&`), both percent-encoded. Null email → unchanged. */
    fun withEmailParam(url: String, param: String, email: String?): String {
        if (email == null) return url
        val separator = if ('?' in url) '&' else '?'
        return "$url$separator${encodeUrlComponent(param)}=${encodeUrlComponent(email)}"
    }

    /**
     * Percent-encodes [value] as UTF-8, leaving only RFC 3986 unreserved characters (`A-Z a-z 0-9 - . _ ~`).
     * `+` becomes `%2B`, so `a+b@x.com` survives a payment page's query parsing.
     */
    fun encodeUrlComponent(value: String): String = buildString {
        for (byte in value.encodeToByteArray()) {
            val b = byte.toInt() and 0xFF
            val c = b.toChar()
            if (b < 0x80 && (c.isLetterOrDigit() || c == '-' || c == '.' || c == '_' || c == '~')) {
                append(c)
            } else {
                append('%')
                append(HEX[b shr 4])
                append(HEX[b and 0x0F])
            }
        }
    }

    private const val HEX = "0123456789ABCDEF"
    private val NATIVE_STORES = setOf("google_play", "app_store")
    private val WEB_PROVIDERS = setOf("razorpay", "stripe")

    /**
     * Which currencies each web provider can charge for a product, from the `/config` product row's own
     * price/plan maps (`stripe_price_id_by_currency[_test]`, `razorpay_plan_id_by_currency[_test]`).
     * Live Stripe ids that a live sync has not verified (`live_stripe_ids_verified: false`) may still be
     * TEST ids, so they do not count in live mode. Read from the raw JSON: [ProductDto] does not carry
     * the maps and widening that public class is a binary change.
     */
    fun chargeableCurrencies(product: JsonObject, test: Boolean): Map<String, Set<String>> = buildMap {
        fun keys(field: String): Set<String> = (product[field] as? JsonObject).orEmpty()
            .filter { (_, v) -> (v as? JsonPrimitive)?.contentOrNull?.isNotBlank() == true }
            .keys.map { it.uppercase() }.toSet()
        val stripeVerified = test || product.bool("live_stripe_ids_verified") != false
        val stripe = if (stripeVerified) {
            keys(
                if (test) "stripe_price_id_by_currency_test" else "stripe_price_id_by_currency",
            )
        } else {
            emptySet()
        }
        val razorpay = keys(if (test) "razorpay_plan_id_by_currency_test" else "razorpay_plan_id_by_currency")
        if (stripe.isNotEmpty()) put("stripe", stripe)
        if (razorpay.isNotEmpty()) put("razorpay", razorpay)
    }

    /**
     * Every web provider that can charge [sku] in the currency the buyer is shown — the web has no store
     * rules, so ALL of them are offered (the "Choose how to pay" list), the one `/config` bound first. A
     * provider qualifies with a payment link in that currency or a price/plan for it ([chargeable]).
     */
    fun webPaymentOptions(
        cfg: SuiteConfig,
        sku: String,
        test: Boolean,
        requestedCurrency: String?,
        chargeable: Map<String, Set<String>>,
    ): List<String> {
        val product = cfg.products.firstOrNull { it.sku == sku } ?: return emptyList()
        val shown = (requestedCurrency ?: product.resolvedPrice?.currency ?: product.baseCurrency).uppercase()
        // /config binds the product to a provider only when it holds a price/plan in the served currency, so
        // the bound one can always charge it (when the caller asks for that same currency).
        val bound = product.storeBinding?.provider?.takeUnless { it in NATIVE_STORES }
            ?.takeIf { requestedCurrency == null || requestedCurrency.equals(product.resolvedPrice?.currency, true) }
            ?.let(::webProvider)
        val able = cfg.providers.map { it.provider }.distinct().filter { p ->
            p in WEB_PROVIDERS &&
                (
                    p == bound ||
                        paymentLinks(cfg, p, sku, test).keys.any { it.equals(shown, true) } ||
                        shown in chargeable[p].orEmpty()
                    )
        }
        return able.sortedBy { if (it == bound) 0 else 1 }
    }

    /** `stripe_card` → `stripe`, `razorpay` → `razorpay`; null for anything that is not a web provider. */
    private fun webProvider(method: String): String? =
        WEB_PROVIDERS.firstOrNull { method == it || method.startsWith("${it}_") }

    private fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull
    private fun JsonObject.bool(key: String): Boolean? = this[key]?.jsonPrimitive?.booleanOrNull
}

/** How a web buyer pays for a product ([PayCraftContract.routeWebCheckout]). */
@PayCraftInternalApi
sealed class WebCheckoutRoute {
    /** Open [url] (a provider-hosted payment page). */
    @PayCraftInternalApi
    data class PaymentLink(val provider: String, val url: String) : WebCheckoutRoute()

    /** Ask `checkout-initiate` for a per-customer [provider] page, priced in [currency]. */
    @PayCraftInternalApi
    data class ServerCheckout(val currency: String, val provider: String) : WebCheckoutRoute()

    /** No way to pay on the web for this product. */
    @PayCraftInternalApi
    data class Unavailable(val reason: WebCheckoutFailure, val message: String) : WebCheckoutRoute()
}

/** Why a web checkout cannot start. [NoPaymentLink] is kept for callers' error codes; routing no longer
 *  returns it, since both web providers now have a server lane. */
@PayCraftInternalApi
enum class WebCheckoutFailure { UnknownSku, NoWebProvider, NoPaymentLink }
