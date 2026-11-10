package com.mobilebytelabs.paycraft.web

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.promise
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import kotlin.js.Promise

/**
 * PayCraft for plain JavaScript / TypeScript websites.
 *
 * ```ts
 * const pc = new PayCraftWeb("pk_live_…");          // PayCraft Cloud, like PayCraft.initialize(apiKey)
 * if (!pc.isAdFree()) loadAds();                 // synchronous, from cache — decide before any ad loads
 * await pc.signIn("google", googleIdToken, null); // same identity path as the mobile SDK
 * const { isPremium } = await pc.premium();
 * location.href = await pc.checkoutUrl("pro_monthly", "INR");
 * ```
 *
 * Same contract as `cmp-paycraft`: a Google/Apple ID token is verified by `identity-token/verify`,
 * that verified email registers this browser via `register_device`, and premium is
 * `check_premium_with_device` with the resulting token. `isAdFree()` mirrors `isPremium()` exactly
 * as `PayCraft.isAdFree` does in the app. The only required argument is the tenant's PUBLISHABLE key;
 * no secret ever belongs in a web page.
 */
@JsExport
class PayCraftWeb(
    private val apiKey: String,
    /**
     * `"test"` or `"live"`. Optional: when null the key decides (`pk_test_…` → test, anything else → live).
     * Tenants created since migration 148 get ONE modeless key (`pk_<hex>`), so a site that wants test
     * links, test devices and sandbox checkout passes `"test"` explicitly.
     */
    mode: String? = null,
    /** Self-hosted PayCraft only. Default: PayCraft Cloud — the same backend `PayCraft.initialize(apiKey)` uses. */
    backendUrl: String? = null,
    /** Self-hosted PayCraft only (that backend's public anon key). Default: PayCraft Cloud's. */
    private val anonKey: String = CLOUD_SUPABASE_ANON_KEY,
) {
    private val base = (backendUrl ?: CLOUD_SUPABASE_URL).trimEnd('/')
    private val mode = when (mode?.lowercase()) {
        "test" -> "test"
        "live" -> "live"
        else -> if (apiKey.startsWith("pk_test_")) "test" else "live"
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }
    private var cachedConfig: ConfigWire? = null

    // Seams — replaced by tests; not part of the exported API.
    internal var transport: Transport = FetchTransport()
    internal var store: TokenStore = TokenStore(BrowserKeyValue())
    internal var now: () -> Double = { js("Date.now()") as Double }
    internal var newDeviceId: () -> String = ::randomDeviceId
    internal var deviceName: () -> String = ::browserDeviceName

    // ── Exported API ─────────────────────────────────────────────────────────────────────────

    /** Products, providers (primary first) and sign-in client ids for this tenant. */
    fun config(): Promise<WebConfig> = scope.promise { loadConfig() }

    /**
     * Signs in with a Google (`"google"`) or Apple (`"apple"`) ID token obtained by the page
     * (Google Identity Services / Sign in with Apple JS). Resolves with the verified email.
     */
    fun signIn(provider: String, idToken: String, nonce: String?): Promise<SignInResult> =
        scope.promise { doSignIn(provider, idToken, nonce) }

    /**
     * After a sign-in that reported a conflict: moves the account to this browser. PayCraft allows ONE
     * active device per account (any platform), so this SIGNS THE OTHER DEVICE OUT of premium — ask the
     * buyer first ("Use premium here instead of <device>?"); never call it automatically.
     */
    fun useThisDevice(): Promise<Boolean> = scope.promise { doUseThisDevice() }

    /** Asks the server, updates the cache, and resolves with the fresh status. */
    fun premium(): Promise<PremiumState> = scope.promise { refreshPremium() }

    /** The buyer's subscription (plan, status, renewal), or null when signed out or there is none. */
    fun subscription(): Promise<WebSubscription?> = scope.promise { loadSubscription() }

    /** Cached premium status (no network). False when unknown, expired, or signed out. */
    fun isPremium(): Boolean {
        val cache = store.premium() ?: return false
        return cache.isPremium && now() - cache.at < PREMIUM_CACHE_TTL_MS
    }

    /** Same as [isPremium] — the name a page uses for "should I show ads?". */
    fun isAdFree(): Boolean = isPremium()

    /** The signed-in email, or null. */
    fun email(): String? = store.email()

    /** A checkout URL for [sku] for the signed-in buyer (Razorpay subscription or Stripe payment link). */
    fun checkoutUrl(sku: String, currency: String?): Promise<String> =
        scope.promise { resolveCheckoutUrl(sku, currency) }

    /** Forgets the identity and premium status on this browser. */
    fun signOut() {
        store.clear()
    }

    // ── Implementation (internal; called directly by tests) ─────────────────────────────────

    internal suspend fun loadConfig(): WebConfig {
        val res = call("GET", "$base/functions/v1/config?apiKey=${encode(apiKey)}", null)
        val wire = decode(ConfigWire.serializer(), res)
        cachedConfig = wire
        return WebConfig(
            products = wire.products.map { it.toWeb() }.toTypedArray(),
            providers = wire.providers.map { it.provider }.toTypedArray(),
            googleClientId = wire.auth?.googleWebClientId,
            appleServicesId = wire.auth?.appleServicesId,
            mode = wire.mode,
        )
    }

    internal suspend fun doSignIn(provider: String, idToken: String, nonce: String?): SignInResult {
        val verifyBody = buildJsonObject {
            put("api_key", apiKey)
            put("provider", provider)
            put("id_token", idToken)
            if (nonce != null) put("nonce", nonce)
        }.toString()
        val verified =
            decode(VerifyWire.serializer(), call("POST", "$base/functions/v1/identity-token/verify", verifyBody))
        val email = verified.email?.takeIf { it.isNotBlank() }
            ?: throw PayCraftWebError("identity_unverified", "The identity provider returned no verified email")

        // Only ever register an email the server just verified — never a typed one.
        val deviceId = store.deviceId() ?: newDeviceId().also { store.saveDeviceId(it) }
        val registerBody = buildJsonObject {
            put("p_email", email)
            put("p_platform", "web")
            put("p_device_name", deviceName())
            put("p_device_id", deviceId)
            put("p_mode", mode)
            put("p_api_key", apiKey)
        }.toString()
        val reg = decode(RegisterWire.serializer(), call("POST", "$base/rest/v1/rpc/register_device", registerBody))
        val token = reg.serverToken ?: throw PayCraftWebError("register_failed", "register_device returned no token")
        store.saveSignIn(token, email)
        return SignInResult(email, reg.conflict, reg.conflictingDeviceName)
    }

    internal suspend fun doUseThisDevice(): Boolean {
        val token = store.token() ?: throw PayCraftWebError("sign_in_required", "Sign in first")
        val body = buildJsonObject {
            put("p_server_token", token)
            put("p_new_device_token", token)
            put("p_api_key", apiKey)
        }.toString()
        val moved = decode(
            TransferWire.serializer(),
            call("POST", "$base/rest/v1/rpc/transfer_to_device", body),
        ).transferred
        if (moved) refreshPremium()
        return moved
    }

    internal suspend fun refreshPremium(): PremiumState {
        val token = store.token() ?: return PremiumState(isPremium = false, tokenValid = false, email = null)
        val body = buildJsonObject {
            put("p_server_token", token)
            put("p_api_key", apiKey)
        }.toString()
        val wire = decode(PremiumWire.serializer(), call("POST", "$base/rest/v1/rpc/check_premium_with_device", body))
        val premium = wire.isPremium && wire.tokenValid
        val email = wire.email ?: store.email()
        store.savePremium(PremiumCache(isPremium = premium, email = email, at = now()))
        return PremiumState(isPremium = premium, tokenValid = wire.tokenValid, email = email)
    }

    internal suspend fun loadSubscription(): WebSubscription? {
        val token = store.token() ?: return null
        val body = buildJsonObject {
            put("p_server_token", token)
            put("p_api_key", apiKey)
        }.toString()
        val rows = decode(ListSerializer(SubscriptionWire.serializer()), call("POST", "$base/rest/v1/rpc/get_subscription", body))
        val s = rows.firstOrNull() ?: return null
        return WebSubscription(
            plan = s.plan,
            status = s.status,
            provider = s.provider,
            renewsAt = s.currentPeriodEnd,
            cancelAtPeriodEnd = s.cancelAtPeriodEnd == true,
            trialEndsAt = s.trialEnd,
        )
    }

    /**
     * Same routing as the app (`PayCraft.requiresServerCheckout`): the product's own provider
     * (`store_binding.provider`, else the tenant's primary web provider); its payment link for this
     * mode when one exists; server checkout (`checkout-initiate`, Razorpay subscriptions only) when the
     * product has no link. Currency follows `CurrencyResolver.checkoutCurrency`: requested → the price
     * the buyer saw → USD → first available.
     */
    internal suspend fun resolveCheckoutUrl(sku: String, currency: String?): String {
        val email = store.email() ?: throw PayCraftWebError("sign_in_required", "Sign in before checkout")
        val cfg = cachedConfig ?: run {
            loadConfig()
            cachedConfig!!
        }
        val product = cfg.products.firstOrNull { it.sku == sku }
            ?: throw PayCraftWebError("unknown_sku", "No product $sku in this tenant's config")
        val bound = product.storeBinding?.provider?.takeUnless { it in NATIVE_STORES }
        val provider = (bound?.let { name -> cfg.providers.firstOrNull { it.provider == name } })
            ?: cfg.providers.firstOrNull { it.provider in WEB_PROVIDERS }
            ?: throw PayCraftWebError("no_web_provider", "No web checkout provider is enabled for this tenant")
        val links = (if (mode == "test") provider.testPaymentLinks else provider.livePaymentLinks)
            ?.get(sku).orEmpty().filterValues { it.isNotBlank() }
        val shown = currency ?: product.resolvedPrice?.currency ?: product.baseCurrency
        if (links.isNotEmpty()) {
            val link = links.getValue(checkoutCurrency(shown, links.keys))
            return if (provider.provider == "stripe") withEmail(link, "prefilled_email", email) else link
        }
        if (provider.provider != "razorpay") {
            throw PayCraftWebError("no_payment_link", "No $mode ${provider.provider} payment link for $sku")
        }
        val body = buildJsonObject {
            put("sku", sku)
            put("currency", shown)
            putJsonObject("customer") { put("email", email) }
        }.toString()
        val res = call("POST", "$base/functions/v1/checkout-initiate?apiKey=${encode(apiKey)}", body)
        return decode(CheckoutWire.serializer(), res).url
            ?: throw PayCraftWebError("checkout_failed", "checkout-initiate returned no url")
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────────────────────

    private suspend fun call(method: String, url: String, body: String?): HttpResult {
        val headers = buildMap {
            put("apikey", anonKey)
            put("Authorization", "Bearer $anonKey")
            put("x-paycraft-platform", "web")
            put("x-paycraft-mode", mode)
            if (body != null) put("content-type", "application/json")
        }
        val res = try {
            transport.send(method, url, headers, body)
        } catch (e: Throwable) {
            throw PayCraftWebError("network_error", e.message ?: "Network request failed")
        }
        if (!res.ok) {
            val err = runCatching { json.decodeFromString(ErrorWire.serializer(), res.body) }.getOrNull()
            throw PayCraftWebError("http_${res.status}", err?.error ?: err?.message ?: "Request failed (${res.status})")
        }
        return res
    }

    private fun <T> decode(serializer: KSerializer<T>, res: HttpResult): T = try {
        json.decodeFromString(serializer, res.body)
    } catch (e: Throwable) {
        throw PayCraftWebError("bad_response", "Unexpected response: ${e.message}")
    }
}

private val NATIVE_STORES = setOf("google_play", "app_store")
private val WEB_PROVIDERS = setOf("razorpay", "stripe")

/** `CurrencyResolver.checkoutCurrency` from cmp-paycraft: shown → USD → first available. */
internal fun checkoutCurrency(shown: String, available: Set<String>): String = when {
    shown in available -> shown
    "USD" in available -> "USD"
    else -> available.first()
}

private fun withEmail(link: String, param: String, email: String): String {
    val separator = if ('?' in link) '&' else '?'
    return "$link$separator$param=${encode(email)}"
}

private fun encode(value: String): String = js("encodeURIComponent")(value) as String

private fun randomDeviceId(): String = js(
    "(globalThis.crypto && globalThis.crypto.randomUUID) ? globalThis.crypto.randomUUID() : " +
        "('web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2))",
) as String

private fun browserDeviceName(): String {
    val ua = js("(typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''") as String
    val browser = when {
        "Edg/" in ua -> "Edge"
        "OPR/" in ua -> "Opera"
        "Chrome/" in ua -> "Chrome"
        "Firefox/" in ua -> "Firefox"
        "Safari/" in ua -> "Safari"
        else -> "Browser"
    }
    val os = when {
        "Android" in ua -> "Android"
        "iPhone" in ua || "iPad" in ua -> "iOS"
        "Windows" in ua -> "Windows"
        "Mac OS" in ua -> "macOS"
        "Linux" in ua -> "Linux"
        else -> "web"
    }
    return "$browser on $os"
}
