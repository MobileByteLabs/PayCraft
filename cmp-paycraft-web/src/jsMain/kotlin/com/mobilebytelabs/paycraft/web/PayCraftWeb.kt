package com.mobilebytelabs.paycraft.web

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.mobilebytelabs.paycraft.contract.WebCheckoutFailure
import com.mobilebytelabs.paycraft.contract.WebCheckoutRoute
import com.mobilebytelabs.paycraft.network.ActiveDevice
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.promise
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
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
 * location.href = await pc.checkoutUrl("pro-monthly", "INR");
 * ```
 *
 * Same contract as `cmp-paycraft` — literally: every URL, header, request body, response parser and
 * the web checkout routing come from `PayCraftContract` in `cmp-paycraft-core`, the module the app SDK
 * is built on. This class only moves those bytes with `fetch` and keeps the session in localStorage.
 * A Google/Apple ID token is verified by `identity-token/verify`,
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
    private val anonKey: String = PayCraftBackend.Cloud.supabaseAnonKey,
) {
    private val base = (backendUrl ?: PayCraftBackend.Cloud.supabaseUrl).trimEnd('/')
    private val mode = when (mode?.lowercase()) {
        "test" -> "test"
        "live" -> "live"
        else -> if (apiKey.startsWith("pk_test_")) "test" else "live"
    }
    internal val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }
    private var cachedConfig: SuiteConfig? = null

    // Seams — replaced by tests; not part of the exported API.
    internal var transport: Transport = FetchTransport()
    internal var store: TokenStore = TokenStore(BrowserKeyValue())
    internal var now: () -> Double = { js("Date.now()") as Double }

    /** The page checkout starts from — a Stripe Checkout Session returns the buyer here. Null off-browser. */
    internal var currentPage: () -> String? = {
        js("(typeof location !== 'undefined' && location.href) ? location.href : null") as String?
    }
    internal var newDeviceId: () -> String = ::randomDeviceId

    /** Leaves for the provider's payment page. */
    internal var navigate: (String) -> Unit = { url -> js("location.assign(url)") }
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
    fun useThisDevice(): Promise<Boolean> = scope.promise { doUseThisDevice(null) }

    /**
     * The visitor's country (ISO 3166-1 alpha-2, e.g. "IN"), so [config] returns that country's prices
     * and currency — the same signal the app SDK sends (`Accept-Language: en-<country>`).
     *
     * A browser's own Accept-Language is a LANGUAGE preference (most browsers in India say `en-US`), not
     * where the visitor is, so a site should pass its edge's IP country here (Cloudflare `request.cf.country`
     * / `CF-IPCountry`). Anything that is not a 2-letter country is ignored (never a made-up region);
     * null goes back to the browser's own header. Changing it drops the cached config.
     */
    fun setCountry(country: String?) {
        if (country == null) {
            visitorCountry = null
            cachedConfig = null
            return
        }
        val cc = country.trim().uppercase()
        if (!Regex("^[A-Z]{2}$").matches(cc) || cc == "XX") return
        if (cc != visitorCountry) cachedConfig = null
        visitorCountry = cc
    }

    private var visitorCountry: String? = null

    /**
     * After a sign-in that reported a conflict because the subscription is at its device limit: the
     * devices holding its seats, newest first (empty from servers without a device limit).
     */
    fun activeDevices(): Array<WebDevice> = conflictDevices.map { it.toWeb(maxDevicesSeen) }.toTypedArray()

    /** How many devices one subscription may have active at once (known after a sign-in). */
    fun maxDevices(): Int = maxDevicesSeen

    /** Signs out the device the buyer chose ([WebDevice.ref]) and uses Pro in this browser instead. */
    fun useThisDeviceInstead(deviceRef: String): Promise<Boolean> = scope.promise { doUseThisDevice(deviceRef) }

    /** "Your devices": the subscription's active devices, this browser first. Empty when signed out. */
    fun devices(): Promise<Array<WebDevice>> = scope.promise { loadDevices().toTypedArray() }

    /** Signs out one device by [WebDevice.ref]; signing out THIS browser signs it out here too. */
    fun signOutDevice(deviceRef: String): Promise<Boolean> = scope.promise { doSignOutDevice(deviceRef) }

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
        scope.promise { resolveCheckoutUrl(sku, currency, null) }

    /**
     * Every way to pay for [sku] in [currency] (null = the price the buyer saw) — each web provider that can
     * charge it, the tenant's default first. The web has no store rules, so a site shows them all ("Choose how
     * to pay") and passes the pick to [checkoutUrlWith]. Empty until [config] has loaded.
     */
    fun paymentOptions(sku: String, currency: String?): Array<WebPaymentOption> {
        val cfg = cachedConfig ?: return emptyArray()
        return PayCraftContract.webPaymentOptions(cfg, sku, mode == "test", currency, chargeableBySku[sku].orEmpty())
            .map {
                WebPaymentOption(
                    it,
                    providerDisplayName(it),
                    paymentMethods(it, currency ?: productCurrency(sku)).summary,
                )
            }
            .toTypedArray()
    }

    /** [checkoutUrl] with the provider the buyer chose from [paymentOptions] (ignored if it cannot charge). */
    fun checkoutUrlWith(sku: String, currency: String?, provider: String): Promise<String> =
        scope.promise { resolveCheckoutUrl(sku, currency, provider) }

    /**
     * PayCraft's checkout page for [sku], rendered into [container] (an empty element on the site's own
     * `/checkout` page): the order summary, a card per provider listing every way it can take this buyer's
     * price (UPI, cards, netbanking, wallets, Apple Pay, Google Pay — what the currency allows), and the pay
     * button that hands over to the chosen provider's secure page. Signed out, an unknown plan or no provider
     * show a notice instead. Styles are scoped to `.pcx` and inherit the site's font and colour; brand it with
     * `--pcx-accent`, `--pcx-accent-fg` and `--pcx-radius`. Resolves true when the payment page is shown.
     */
    fun mountCheckout(container: dynamic, sku: String, options: CheckoutPageOptions?): Promise<Boolean> =
        prepareCheckout(container).let { scope.promise { renderCheckout(container, sku, checkoutView(sku, options)) } }

    private var chargeableBySku: Map<String, Map<String, Set<String>>> = emptyMap()

    /** The currency [sku] is shown in for this visitor (their region's price), or null before [config]. */
    internal fun productCurrency(sku: String): String? =
        cachedConfig?.products?.firstOrNull { it.sku == sku }?.toWeb()?.currency

    /** Forgets the identity and premium status on this browser. */
    fun signOut() {
        store.clear()
    }

    // ── Implementation (internal; called directly by tests) ─────────────────────────────────

    internal suspend fun loadConfig(): WebConfig {
        // The country rides in the URL as well as in Accept-Language: /config is browser-cacheable and does not
        // vary on Accept-Language, so only a different URL keeps a cached response priced for another country
        // from being reused. The server reads `?country=` as an explicit override of the same value.
        val url = PayCraftContract.configUrl(base, apiKey) + (visitorCountry?.let { "&country=$it" } ?: "")
        val res = call("GET", url, null)
        val cfg = try {
            PayCraftContract.decodeConfigForWeb(res.body)
        } catch (e: Throwable) {
            throw PayCraftWebError("bad_response", "Unexpected response: ${e.message}")
        }
        cachedConfig = cfg
        // The per-currency price/plan maps the shared model does not carry: which providers can charge what.
        chargeableBySku = runCatching {
            val test = mode == "test"
            json.parseToJsonElement(res.body).jsonObject["products"]?.jsonArray.orEmpty().mapNotNull { e ->
                val o = e as? JsonObject ?: return@mapNotNull null
                val sku = o["sku"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                sku to PayCraftContract.chargeableCurrencies(o, test)
            }.toMap()
        }.getOrDefault(emptyMap())
        return cfg.toWebConfig()
    }

    internal suspend fun doSignIn(provider: String, idToken: String, nonce: String?): SignInResult {
        val verifyBody = PayCraftContract.identityVerifyBody(apiKey, provider, idToken, nonce)
        val verified = obj(call("POST", PayCraftContract.identityVerifyUrl(base), verifyBody.toString()))
        val email = PayCraftContract.parseVerifiedEmail(verified)
            ?: throw PayCraftWebError("identity_unverified", "The identity provider returned no verified email")

        // Only ever register an email the server just verified — never a typed one.
        val deviceId = store.deviceId() ?: newDeviceId().also { store.saveDeviceId(it) }
        val params = PayCraftContract.registerDeviceParams(email, "web", deviceName(), deviceId, mode, apiKey)
        val reg = PayCraftContract.parseRegister(
            obj(call("POST", PayCraftContract.rpcUrl(base, "register_device"), params.toString())),
        ) ?: throw PayCraftWebError("register_failed", "register_device returned no token")
        store.saveSignIn(reg.deviceToken, email)
        conflictDevices = if (reg.conflict) reg.activeDevices else emptyList()
        maxDevicesSeen = reg.maxDevices
        return SignInResult(email, reg.conflict, reg.conflictingDeviceName)
    }

    private var conflictDevices: List<ActiveDevice> = emptyList()
    private var maxDevicesSeen: Int = 1

    internal suspend fun doUseThisDevice(replaceDevice: String?): Boolean {
        val token = store.token() ?: throw PayCraftWebError("sign_in_required", "Sign in first")
        val params = PayCraftContract.transferParams(token, token, apiKey, replaceDevice)
        val moved = PayCraftContract.parseTransferred(
            obj(call("POST", PayCraftContract.rpcUrl(base, "transfer_to_device"), params.toString())),
        )
        if (moved) {
            conflictDevices = emptyList()
            refreshPremium()
        }
        return moved
    }

    internal suspend fun loadDevices(): List<WebDevice> {
        val token = store.token() ?: return emptyList()
        val params = PayCraftContract.tokenParams(token, apiKey)
        val rows = Json.parseToJsonElement(
            call("POST", PayCraftContract.rpcUrl(base, "get_active_devices"), params.toString()).body,
        )
        return PayCraftContract.parseDevices(rows as? JsonArray).map { it.toWeb(it.maxDevices) }
    }

    internal suspend fun doSignOutDevice(deviceRef: String): Boolean {
        val token = store.token() ?: throw PayCraftWebError("sign_in_required", "Sign in first")
        val self = loadDevices().firstOrNull { it.ref == deviceRef }?.thisDevice == true
        val params = PayCraftContract.signOutDeviceParams(token, deviceRef, apiKey)
        val ok = PayCraftContract.parseSignedOut(
            obj(call("POST", PayCraftContract.rpcUrl(base, "sign_out_device"), params.toString())),
        )
        if (ok && self) signOut()
        return ok
    }

    private fun ActiveDevice.toWeb(max: Int) = WebDevice(ref, name, platform, lastSeen, thisDevice, max)

    internal suspend fun refreshPremium(): PremiumState {
        val token = store.token() ?: return PremiumState(isPremium = false, tokenValid = false, email = null)
        val params = PayCraftContract.tokenParams(token, apiKey)
        val result = PayCraftContract.parsePremium(
            obj(call("POST", PayCraftContract.rpcUrl(base, "check_premium_with_device"), params.toString())),
        )
        val premium = result.isPremium && result.tokenValid
        val email = result.boundEmail ?: store.email()
        store.savePremium(PremiumCache(isPremium = premium, email = email, at = now()))
        return PremiumState(isPremium = premium, tokenValid = result.tokenValid, email = email)
    }

    internal suspend fun loadSubscription(): WebSubscription? {
        val token = store.token() ?: return null
        val params = PayCraftContract.tokenParams(token, apiKey)
        val rows = decode(
            ListSerializer(SubscriptionWire.serializer()),
            call("POST", PayCraftContract.rpcUrl(base, "get_subscription"), params.toString()),
        )
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

    /** Where the buyer pays: [PayCraftContract.routeWebCheckout] — the app's web-lane routing. */
    internal suspend fun resolveCheckoutUrl(sku: String, currency: String?, provider: String? = null): String {
        val email = store.email() ?: throw PayCraftWebError("sign_in_required", "Sign in before checkout")
        val cfg = cachedConfig ?: run {
            loadConfig()
            cachedConfig!!
        }
        val route = PayCraftContract.routeWebCheckout(
            cfg,
            sku,
            mode == "test",
            currency,
            email,
            preferredProvider = provider,
            chargeable = chargeableBySku[sku].orEmpty(),
        )
        return when (route) {
            is WebCheckoutRoute.PaymentLink -> route.url
            is WebCheckoutRoute.ServerCheckout -> {
                val body = buildJsonObject {
                    put("sku", sku)
                    put("currency", route.currency)
                    put("provider", route.provider)
                    currentPage()?.let { put("return_url", it) }
                    putJsonObject("customer") { put("email", email) }
                }.toString()
                val res = call("POST", PayCraftContract.checkoutInitiateUrl(base, apiKey), body)
                decode(CheckoutWire.serializer(), res).url
                    ?: throw PayCraftWebError("checkout_failed", "the server returned no checkout url")
            }
            is WebCheckoutRoute.Unavailable -> throw PayCraftWebError(route.reason.code(), route.message)
        }
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────────────────────

    private suspend fun call(method: String, url: String, body: String?): HttpResult {
        val headers = PayCraftContract.headers(anonKey, "web", mode, json = body != null) +
            (visitorCountry?.let { mapOf("Accept-Language" to "en-$it") } ?: emptyMap())
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

    private fun obj(res: HttpResult): JsonObject = try {
        json.parseToJsonElement(res.body).jsonObject
    } catch (e: Throwable) {
        throw PayCraftWebError("bad_response", "Unexpected response: ${e.message}")
    }

    private fun <T> decode(serializer: KSerializer<T>, res: HttpResult): T = try {
        json.decodeFromString(serializer, res.body)
    } catch (e: Throwable) {
        throw PayCraftWebError("bad_response", "Unexpected response: ${e.message}")
    }
}

/** The stable error code a page sees for each reason the web cannot take a payment. */
private fun WebCheckoutFailure.code(): String = when (this) {
    WebCheckoutFailure.UnknownSku -> "unknown_sku"
    WebCheckoutFailure.NoWebProvider -> "no_web_provider"
    WebCheckoutFailure.NoPaymentLink -> "no_payment_link"
}

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
