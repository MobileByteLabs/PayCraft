package com.mobilebytelabs.paycraft.web

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.analytics.PayCraftEvent
import com.mobilebytelabs.paycraft.analytics.PayCraftEventName
import com.mobilebytelabs.paycraft.analytics.PayCraftStep
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.contract.PayCraftContract
import com.mobilebytelabs.paycraft.contract.WebCheckoutFailure
import com.mobilebytelabs.paycraft.contract.WebCheckoutRoute
import com.mobilebytelabs.paycraft.network.ActiveDevice
import com.mobilebytelabs.paycraft.winback.ExitSurveyConfig
import com.mobilebytelabs.paycraft.winback.WinbackResult
import com.mobilebytelabs.paycraft.winback.exitSurveyDue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.promise
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
        js("(globalThis.location || {}).href || null") as String?
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
    fun useThisDevice(): Promise<Boolean> = moveHere(null)

    // One suspend lambda shared by useThisDevice and useThisDeviceInstead (bundle budget).
    private fun moveHere(replaceDevice: String?): Promise<Boolean> = scope.promise { doUseThisDevice(replaceDevice) }

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

    // ── Paywall events (paycraft-paywall-analytics) ─────────────────────────────────────────────

    private var eventListener: ((String, dynamic) -> Unit)? = null
    private val pendingEvents = mutableListOf<PayCraftEvent>()
    private var flushScheduled = false

    /** Sends a body with no headers when the page is going away (`navigator.sendBeacon`). Replaced in tests. */
    internal var beacon: (String, String) -> Boolean = sendBeaconJs

    /**
     * Every paywall event, for the site to forward — e.g. `pc.onEvent((name, params) => gtag("event", name, params))`.
     * The same names and params as the apps' events (the PayCraftEvent catalog), already GA4-valid.
     */
    fun onEvent(listener: (name: String, params: dynamic) -> Unit) {
        eventListener = listener
    }

    internal fun track(
        name: PayCraftEventName,
        step: PayCraftStep,
        sku: String? = null,
        currency: String? = null,
        provider: String? = null,
        reason: String? = null,
    ) {
        val e = PayCraftEvent(
            name, step, platform = "web", sku = sku, currency = currency, country = visitorCountry,
            provider = provider, reason = reason, atMs = now().toLong(),
        )
        eventListener?.let { l ->
            runCatching {
                val o: dynamic = js("({})")
                e.params().forEach { (k, v) -> o[k] = v }
                l(name.wire, o)
            }
        }
        if (pendingEvents.size >= MAX_PENDING_EVENTS) pendingEvents.removeAt(0)
        pendingEvents.add(e)
        if (!flushScheduled) {
            flushScheduled = true
            // The browser's timer, not a coroutine delay: the events path stays out of the coroutines bundle.
            setTimeoutJs({ scope.promise { flushEvents() } }, EVENT_FLUSH_MS)
        }
    }

    internal fun pendingEventCount(): Int = pendingEvents.size

    /** Drains the queue into an `events` body (mode in the body too: a beacon carries no headers). */
    private fun drainEvents(): String? {
        if (pendingEvents.isEmpty()) return null
        val batch = pendingEvents.toList()
        pendingEvents.clear()
        val deviceRef = myDeviceId()
        val body = PayCraftContract.eventsBody(apiKey, deviceRef, store.token(), batch)
        return JsonObject(body + ("mode" to JsonPrimitive(mode))).toString()
    }

    internal suspend fun flushEvents() {
        flushScheduled = false
        val body = drainEvents() ?: return
        runCatching { call("POST", PayCraftContract.eventsUrl(base, apiKey), body) }
    }

    /** The page is being left: what is queued goes out by beacon, which survives the navigation. */
    internal fun flushEventsOnLeave() {
        val body = drainEvents() ?: return
        runCatching { beacon(PayCraftContract.eventsUrl(base, apiKey), body) }
    }

    /**
     * After a sign-in that reported a conflict because the subscription is at its device limit: the
     * devices holding its seats, newest first (empty from servers without a device limit).
     */
    fun activeDevices(): Array<WebDevice> = conflictDevices.map { it.toWeb(maxDevicesSeen) }.toTypedArray()

    /** How many devices one subscription may have active at once (known after a sign-in). */
    fun maxDevices(): Int = maxDevicesSeen

    /** Signs out the device the buyer chose ([WebDevice.ref]) and uses Pro in this browser instead. */
    fun useThisDeviceInstead(deviceRef: String): Promise<Boolean> = moveHere(deviceRef)

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
    fun checkoutUrl(sku: String, currency: String?): Promise<String> = checkoutPromise(sku, currency, null)

    // One suspend lambda shared by checkoutUrl and checkoutUrlWith (each `scope.promise { }` is a class in the bundle).
    private fun checkoutPromise(sku: String, currency: String?, provider: String?): Promise<String> =
        scope.promise { resolveCheckoutUrl(sku, currency, provider) }

    /**
     * Every way to pay for [sku] in [currency] (null = the price the buyer saw) — each web provider that can
     * charge it, the tenant's default first. The web has no store rules, so a site shows them all ("Choose how
     * to pay") and passes the pick to [checkoutUrlWith]. Empty until [config] has loaded.
     */
    fun paymentOptions(sku: String, currency: String?): Array<WebPaymentOption> {
        val cfg = cachedConfig ?: return emptyArray()
        return PayCraftContract.webPaymentOptions(cfg, sku, mode == "test", currency, chargeableBySku[sku].orEmpty())
            .map {
                val info = paymentMethods(it, currency ?: productCurrency(sku))
                WebPaymentOption(
                    it,
                    providerDisplayName(it),
                    info.summary,
                    info.methods.toTypedArray(),
                    info.cardBrands.toTypedArray(),
                    info.note,
                )
            }
            .toTypedArray()
    }

    /** [checkoutUrl] with the provider the buyer chose from [paymentOptions] (ignored if it cannot charge). */
    fun checkoutUrlWith(sku: String, currency: String?, provider: String): Promise<String> =
        checkoutPromise(sku, currency, provider)

    /**
     * A checkout-page step, for a page that renders its own checkout (PayCraft's lazily loaded
     * `paycraft-web-ui` does): [kind] `view` (the payment methods were shown), `select` (the buyer picked
     * [provider]), `start` (they pressed pay), `fail` (it failed, [reason] = the error code), `abandon` (they left
     * without paying) or `leave` (the page is going away — sends what is queued). Recorded as the paywall events
     * of the catalog, so a site never names an event itself; an unknown [kind] is ignored.
     */
    fun checkoutEvent(kind: String, sku: String, currency: String?, provider: String?, reason: String?) {
        val name = when (kind) {
            "view" -> PayCraftEventName.ProviderView
            "select" -> PayCraftEventName.ProviderSelect
            "start" -> PayCraftEventName.CheckoutStart
            "fail" -> PayCraftEventName.PurchaseFail
            "abandon" -> PayCraftEventName.StepAbandon
            "leave" -> null
            else -> return
        }
        if (name != null) {
            val step = if (kind == "start" || kind == "fail") PayCraftStep.Checkout else PayCraftStep.Provider
            track(name, step, sku, currency, provider, reason)
        }
        if (kind == "abandon" || kind == "leave") flushEventsOnLeave()
    }

    // ── Exit survey + win-back (paycraft-paywall-analytics GOAL D3/D6/D7) ───────────────────────

    private var exitSurvey: ExitSurveyConfig? = null
    private var claimedOffer: WebOffer? = null
    private var offered: WebOffer? = null

    /**
     * The tenant's exit survey when it should be shown NOW — on, something to ask, the buyer is not premium, and
     * its cap has passed since it was last shown on this browser — else null. Ask it as the buyer leaves without
     * paying; call [surveyShown] when it is on screen.
     */
    // Promise chains, not `scope.promise { }`: each coroutine is a state-machine class in the 150 KB bundle.
    fun surveyConfig(): Promise<WebExitSurvey?> =
        (if (cachedConfig != null) Promise.resolve(Unit) else config().then({}, {})).then { dueSurvey() }

    private fun dueSurvey(): WebExitSurvey? {
        val cfg = exitSurvey
        if (cfg == null ||
            !exitSurveyDue(cfg, isPremium(), store.surveyShownAt()?.toLong(), now().toLong())
        ) {
            return null
        }
        return WebExitSurvey(
            cfg.title,
            cfg.reasons.map {
                WebSurveyReason(it.code, it.label, it.freeText)
            }.toTypedArray(),
        )
    }

    /** The survey is on screen, asked at [step] (`provider`, `checkout`, `paywall`…): starts its cap, records the view. */
    fun surveyShown(step: String, sku: String?) {
        store.saveSurveyShownAt(now())
        track(PayCraftEventName.SurveyView, stepOf(step), sku, sku?.let { productCurrency(it) })
    }

    /**
     * The buyer's answer: records it (with [freeText] for a reason that asks for it — kept first-party, never in
     * an analytics event) and resolves with what the tenant gives for it: a discount, a message, or nothing.
     * Never rejects — a failed call is `none`, and the buyer simply leaves.
     */
    fun answerSurvey(reasonCode: String, step: String, sku: String?, freeText: String?): Promise<WebWinback> {
        track(PayCraftEventName.SurveyAnswer, PayCraftStep.Survey, sku, reason = reasonCode)
        val deviceRef = myDeviceId()
        val body = PayCraftContract.winbackBody(
            apiKey,
            deviceRef,
            store.token(),
            reasonCode,
            stepOf(step).wire,
            "web",
            sku,
            freeText,
        )
        val json = JsonObject(body + ("mode" to JsonPrimitive(mode))).toString()
        val url = PayCraftContract.winbackUrl(base, apiKey)
        return post(url, json).then({ winbackFrom(it, sku) }, { winbackFrom(null, sku) })
    }

    private fun winbackFrom(raw: String?, sku: String?): WebWinback =
        when (val r = raw?.let { PayCraftContract.decodeWinbackForWeb(it, sku) } ?: WinbackResult.None) {
            is WinbackResult.Message -> WebWinback("message", r.text, null)
            is WinbackResult.Offer -> {
                val o = r.offer
                // Only an offer the web can apply is an offer here (a store-only discount is no use on a website).
                if (!o.stripe && !o.razorpay) return WebWinback("none", null, null)
                val web =
                    WebOffer(o.id, o.percentOff, o.duration, o.durationInMonths, o.expiresAtIso, o.stripe, o.razorpay)
                offered = web
                track(PayCraftEventName.OfferView, PayCraftStep.Offer, sku, reason = "${o.percentOff}pct")
                WebWinback("offer", null, web)
            }
            WinbackResult.None -> WebWinback("none", null, null)
        }

    /**
     * The buyer took the offer [offerId] (from [answerSurvey]): the next [checkoutUrlWith] / [checkoutUrl] applies it
     * on a lane that can (Stripe or Razorpay). If the server no longer accepts it (expired, used), checkout goes
     * ahead at the normal price. False when [offerId] is not the offer this page was given.
     */
    fun claimOffer(offerId: String): Boolean {
        val o = offered?.takeIf { it.id == offerId } ?: return false
        claimedOffer = o
        track(PayCraftEventName.OfferAccept, PayCraftStep.Offer)
        return true
    }

    /** The offer the next checkout applies ([claimOffer]), or null. */
    fun activeOffer(): WebOffer? = claimedOffer

    /**
     * One device-scoped PayCraft RPC as the signed-in browser — the transport behind paycraft-web-ui's
     * `allowance`, `spendAllowance` and `creditBalance` (migration 189), kept out of this always-loaded bundle.
     * Always as this browser's own device: the server resolves who that is, so a page can never name a subject
     * (it holds nothing a plain fetch with the same token could not do — the server is the guard). Rejects with
     * `sign_in_required` when nobody is signed in here.
     */
    fun deviceCall(fn: String, sku: String, idempotencyKey: String?): Promise<String> {
        val token = store.token() ?: return Promise.reject(PayCraftWebError("sign_in_required", "Sign in first"))
        val p = PayCraftContract.tokenParams(token, apiKey) + ("p_sku" to JsonPrimitive(sku))
        return post(
            PayCraftContract.rpcUrl(base, fn),
            JsonObject(
                if (idempotencyKey ==
                    null
                ) {
                    p
                } else {
                    p + ("p_idempotency_key" to JsonPrimitive(idempotencyKey))
                },
            ).toString(),
        )
    }

    // The one suspend lambda for fire-a-POST-get-the-body calls: each `scope.promise { }` is its own class in the bundle.
    private fun post(url: String, body: String): Promise<String> = scope.promise { call("POST", url, body).body }

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
        exitSurvey = PayCraftContract.decodeExitSurvey(res.body)
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
        // The device id goes WITH the token, so the server marks this device identity-verified (migration 193).
        val deviceId = myDeviceId()
        val verifyBody = PayCraftContract.identityVerifyBody(apiKey, provider, idToken, nonce, deviceId)
        val verified = obj(call("POST", PayCraftContract.identityVerifyUrl(base), verifyBody.toString()))
        val email = PayCraftContract.parseVerifiedEmail(verified)
            ?: throw PayCraftWebError("identity_unverified", "The identity provider returned no verified email")

        // Only ever register an email the server just verified — never a typed one.
        val params = PayCraftContract.registerDeviceParams(email, "web", deviceName(), deviceId, mode, apiKey)
        val reg = PayCraftContract.parseRegister(
            obj(rpc("register_device", params)),
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
            obj(rpc("transfer_to_device", params)),
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
            rpc("get_active_devices", params).body,
        )
        return PayCraftContract.parseDevices(rows as? JsonArray).map { it.toWeb(it.maxDevices) }
    }

    internal suspend fun doSignOutDevice(deviceRef: String): Boolean {
        val token = store.token() ?: throw PayCraftWebError("sign_in_required", "Sign in first")
        val self = loadDevices().firstOrNull { it.ref == deviceRef }?.thisDevice == true
        val params = PayCraftContract.signOutDeviceParams(token, deviceRef, apiKey)
        val ok = PayCraftContract.parseSignedOut(
            obj(rpc("sign_out_device", params)),
        )
        if (ok && self) signOut()
        return ok
    }

    private fun ActiveDevice.toWeb(max: Int) = WebDevice(ref, name, platform, lastSeen, thisDevice, max)

    internal suspend fun refreshPremium(): PremiumState {
        val token = store.token() ?: return PremiumState(isPremium = false, tokenValid = false, email = null)
        val params = PayCraftContract.tokenParams(token, apiKey)
        val result = PayCraftContract.parsePremium(
            obj(rpc("check_premium_with_device", params)),
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
            rpc("get_subscription", params),
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
        // A claimed win-back offer needs a server checkout on a lane that carries it: a Stripe payment link is a
        // fixed price, so with an offer Stripe goes through checkout-initiate (a Checkout Session with the discount).
        val offer = claimedOffer
        return when (route) {
            is WebCheckoutRoute.PaymentLink ->
                if (offer != null && offer.stripe && route.provider == "stripe") {
                    serverCheckoutUrl(sku, currency ?: productCurrency(sku), "stripe", email, offer)
                } else {
                    route.url
                }
            is WebCheckoutRoute.ServerCheckout -> serverCheckoutUrl(
                sku,
                route.currency,
                route.provider,
                email,
                offer?.takeIf {
                    (route.provider == "stripe" && it.stripe) ||
                        (route.provider == "razorpay" && it.razorpay)
                },
            )
            is WebCheckoutRoute.Unavailable -> throw PayCraftWebError(route.reason.code(), route.message)
        }
    }

    /** checkout-initiate; with [offer], the discount — and if the server no longer accepts it, the normal price. */
    private suspend fun serverCheckoutUrl(
        sku: String,
        currency: String?,
        provider: String,
        email: String,
        offer: WebOffer?,
    ): String {
        val body = buildJsonObject {
            put("sku", sku)
            currency?.let { put("currency", it) }
            put("provider", provider)
            currentPage()?.let { put("return_url", it) }
            putJsonObject("customer") { put("email", email) }
            if (offer != null) {
                put("offerId", offer.id)
                store.deviceId()?.let { put("deviceRef", it) }
            }
        }.toString()
        val res = try {
            call("POST", PayCraftContract.checkoutInitiateUrl(base, apiKey), body)
        } catch (e: PayCraftWebError) {
            if (offer == null || e.code != "http_409") throw e
            claimedOffer = null
            return serverCheckoutUrl(sku, currency, provider, email, null)
        }
        return decode(CheckoutWire.serializer(), res).url
            ?: throw PayCraftWebError("checkout_failed", "the server returned no checkout url")
    }

    // ── HTTP ─────────────────────────────────────────────────────────────────────────────────

    // One door for the device RPCs: the URL + POST shape is written once instead of at every call site (bundle budget).
    private suspend fun rpc(fn: String, params: Any): HttpResult =
        call("POST", PayCraftContract.rpcUrl(base, fn), params.toString())

    /** This browser's random device id, created on first use (sign-in, events, win-back). */
    private fun myDeviceId(): String = store.deviceId() ?: newDeviceId().also { store.saveDeviceId(it) }

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

/** A step's wire name (`provider`, `checkout`…) → the catalog step; anything else is the checkout. */
private fun stepOf(wire: String): PayCraftStep =
    PayCraftStep.entries.firstOrNull { it.wire == wire } ?: PayCraftStep.Checkout

private fun randomDeviceId(): String = js(
    "(globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : " +
        "('web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2))",
) as String

private fun browserDeviceName(): String {
    val ua = js("(globalThis.navigator || {}).userAgent || ''") as String
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

private const val MAX_PENDING_EVENTS = 50
private const val EVENT_FLUSH_MS = 3_000

private val setTimeoutJs: (() -> Unit, Int) -> Unit =
    js("(function (f, ms) { if (globalThis.setTimeout) setTimeout(f, ms); })")

// A function expression (not inline js() over Kotlin locals, which the compiler renames).
private val sendBeaconJs: (String, String) -> Boolean = js(
    "(function (u, b) { var n = globalThis.navigator; return n && n.sendBeacon ? n.sendBeacon(u, b) : false; })",
)
