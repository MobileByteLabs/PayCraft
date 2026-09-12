package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.billing.CheckoutLane
import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.NativeDisplayPrice
import com.mobilebytelabs.paycraft.billing.resolveCheckoutLane
import com.mobilebytelabs.paycraft.config.ConfigCache
import com.mobilebytelabs.paycraft.config.ConfigResult
import com.mobilebytelabs.paycraft.config.readBundledSuiteConfigJsonOrNull
import com.mobilebytelabs.paycraft.config.CouponDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.AdFreeEntitlement
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.EntitlementSnapshot
import com.mobilebytelabs.paycraft.core.MonetizationMode
import com.mobilebytelabs.paycraft.core.MonetizationModeResolver
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import com.mobilebytelabs.paycraft.core.SessionDebounce
import com.mobilebytelabs.paycraft.core.TrialSnapshot
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.network.CouponClient
import com.mobilebytelabs.paycraft.network.PayCraftRealtime
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.DeviceFingerprint
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.mobilebytelabs.paycraft.provider.PaymentProvider
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.statement.HttpResponse
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import org.koin.mp.KoinPlatform

/**
 * PayCraft — the single SDK entry point.
 *
 * ```kotlin
 * PayCraft.initialize(apiKey = "pk_live_…")
 * ```
 *
 * All products, providers, pricing, and paywall styling are fetched from your PayCraft
 * dashboard (https://paycraft.mobilebytesensei.com) and refreshed on a tiered cache policy. The SDK
 * exposes no other configuration surface — change anything in the dashboard, your apps
 * pick it up on the next refresh.
 */
object PayCraft {

    internal var config: PayCraftConfig? = null
        private set

    private val _suiteConfigFlow = MutableStateFlow<SuiteConfig?>(null)

    /**
     * Reactive SuiteConfig stream. Compose UIs (paywall, banner) MUST collect this
     * so they recompose when the async cloud fetch — or an explicit [refreshConfig] —
     * publishes an updated config from the dashboard. Reading the non-reactive
     * [suiteConfig] snapshot does NOT trigger recomposition, which is why dashboard
     * edits previously failed to surface in consumer apps until a cold relaunch.
     */
    val suiteConfigFlow: StateFlow<SuiteConfig?> = _suiteConfigFlow.asStateFlow()

    private val _configResultFlow = MutableStateFlow<ConfigResult>(ConfigResult.Loading)

    /**
     * WHICH resilience layer answered, and how much the answer should be trusted.
     *
     * [suiteConfigFlow] deliberately still exists and still emits — every existing consumer keeps
     * working unchanged. What it cannot express is the difference between "no config yet", "the
     * fetch failed", and "this is last week's cache": all three are null or an indistinguishable
     * value there, which is why an offline user sat on a spinner forever. Collect THIS flow to tell
     * those apart.
     */
    val configResultFlow: StateFlow<ConfigResult> = _configResultFlow.asStateFlow()

    internal val suiteConfig: SuiteConfig? get() = _suiteConfigFlow.value

    internal var backend: PayCraftBackend = PayCraftBackend.Cloud
        private set

    internal var apiKey: String? = null
        private set

    /**
     * Whether a usable publishable key has been supplied to [initialize].
     *
     * THE SDK OWNS THIS QUESTION. Consumers previously had to answer it themselves — reading their
     * own build config for a `pk_` key and branching their DI on the result — which meant every host
     * app re-implemented the SDK's provisioning rule and could disagree with it. Ask here instead.
     *
     * Resolving [com.mobilebytelabs.paycraft.core.BillingManager] is valid whether or not this is
     * true: unconfigured, the SDK reports a Free entitlement rather than throwing, so a host can
     * wire billing unconditionally and let the SDK decide what it can deliver.
     */
    val isConfigured: Boolean
        get() = apiKey?.let { it.startsWith("pk_test_") || it.startsWith("pk_live_") } == true

    /**
     * Stable per-(device, app) fingerprint. Available for consumer-app analytics
     * (DAU/MAU dashboards, A/B-test bucketing, crash-correlation). PayCraft itself
     * does not send this value anywhere — Stripe-style test/live mode duality is
     * resolved purely by the [apiKey] prefix.
     *
     * Computed lazily on first access. Logged at `initialize()` for debug visibility.
     */
    val deviceId: String by lazy { DeviceFingerprint.get() }

    /**
     * Resolved test/live mode for this PayCraft instance, derived from the [apiKey]
     * prefix at [initialize] time. Mirrors Stripe's own test-mode model — consumer
     * apps inject `pk_test_*` in debug builds and `pk_live_*` in release builds; the
     * SDK and dashboard pick mode-appropriate payment links (and the server returns
     * mode-appropriate webhook routes) automatically.
     */
    val mode: Mode get() = when {
        apiKey?.startsWith("pk_test_") == true -> Mode.Test
        apiKey?.startsWith("pk_live_") == true -> Mode.Live
        else -> Mode.Unknown
    }

    /** Test/live duality of the active PayCraft key. */
    enum class Mode { Test, Live, Unknown }

    /** Long-lived scope for the SDK's background work — currently just the cloud SuiteConfig fetch. */
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var configFetchJob: Job? = null
    private var initOptions: InitOptions = InitOptions()

    private var _activeCountry: String = CurrencyResolver.DEFAULT_COUNTRY
    private var _activeCurrency: String = CurrencyResolver.FALLBACK_CURRENCY

    // ─── Phase-4 monetization-mode state (AC-9..AC-12) ───────────────────────
    /** The host-supplied init-flag — kept so a fresh SuiteConfig can be re-resolved against it. */
    private var initialMonetizationMode: MonetizationMode = MonetizationMode.AdSupported

    /**
     * The RESOLVED monetization mode = [MonetizationModeResolver.resolve] over
     * ([initialMonetizationMode], [suiteConfig]?.mode). Updated once at
     * [initialize] with a null cloud value, then re-resolved every time
     * [applySuiteConfig] lands a fresh SuiteConfig so a dashboard flip
     * propagates without a host rebuild (AC-9, config-wins precedence).
     */
    private var resolvedMonetizationMode: MonetizationMode = MonetizationMode.AdSupported

    /**
     * The resolved monetization policy in effect (config-wins over init flag).
     * Hosts read this to reason about mode-dependent behaviour (e.g. skip an
     * ad-scheduling scheduler when [MonetizationMode.TrialManaged]).
     */
    val monetizationMode: MonetizationMode get() = resolvedMonetizationMode

    /**
     * Ad-free entitlement flag (AC-12). Mirrors the buyer's subscription status —
     * true when premium/paying, false otherwise. Hosts in
     * [MonetizationMode.AdSupported] mode read this to gate ad rendering; the flag
     * is a re-exported [AdFreeEntitlement.isAdFree] so a single subscription
     * refresh updates every observer atomically.
     */
    val isAdFree: StateFlow<Boolean> get() = AdFreeEntitlement.isAdFree

    private val _paywallPresentation = MutableStateFlow<PaywallPresentation>(PaywallPresentation.Hidden)

    /**
     * Reactive paywall-presentation request signal (AC-10, AC-11). Hosts observe
     * this StateFlow and render [com.mobilebytelabs.paycraft.ui.PayCraftPaywallComposable]
     * (typically inside a modal sheet) when the value is
     * [PaywallPresentation.Shown]; on dismiss the host calls [dismissPaywall] to
     * reset to [PaywallPresentation.Hidden]. Because the SDK is Compose-multiplatform
     * with no UIKit-style modal primitive in commonMain, this observer pattern is
     * the idiom that works across every KMP target.
     */
    val paywallPresentation: StateFlow<PaywallPresentation> = _paywallPresentation.asStateFlow()

    /**
     * The [BillingManager] — the entry point for HEADLESS integration (mode 2).
     * Instead of the drop-in [com.mobilebytelabs.paycraft.ui.PayCraftPaywall], observe
     * [BillingManager.billingState] / [BillingManager.isPremium] / [BillingManager.isInTrial]
     * and drive [checkout] from your OWN UI:
     *
     * ```kotlin
     * val state by PayCraft.billingManager!!.billingState.collectAsState()
     * when (state) {
     *     is BillingState.Free    -> UpgradeButton { PayCraft.checkout(plan) }
     *     is BillingState.Premium -> PremiumContent()
     *     else                    -> Loading()
     * }
     * ```
     * Null until [initialize] has run (the Koin graph isn't up yet).
     */
    val billingManager: BillingManager?
        get() = KoinPlatform.getKoinOrNull()?.getOrNull<BillingManager>()

    /**
     * The purchasable plans for HEADLESS integration (mode 2) — rebuilt from the
     * dashboard config + resolved native-store prices. Empty until the first
     * SuiteConfig fetch resolves (collect [suiteConfigFlow] to recompose when it
     * lands). Pass one of these to [checkout].
     */
    val plans: List<BillingPlan> get() = config?.plans ?: emptyList()

    /**
     * The native store's OWN localized price per plan sku (Play `formattedPrice` / StoreKit
     * `displayPrice`), resolved after products load on native billing lanes. When present it is
     * the truth the store charges and OVERRIDES the cloud `/config` price for the paywall + the
     * per-plan currency (fixes an India buyer seeing GBP instead of the store's ₹799). Empty on
     * web-checkout platforms and until the async native-price fetch completes → cloud price is used.
     */
    private var nativePricesBySku: Map<String, NativeDisplayPrice> = emptyMap()

    /** Last applied SuiteConfig — kept so a late native-price fetch can rebuild + re-emit plans. */
    private var currentSuite: SuiteConfig? = null

    /**
     * THE single resolved billing region — the one (country, currency) the whole paywall uses:
     * the displayed price AND every payment provider's checkout link read this, so a provider
     * can never silently route a different currency than the one shown.
     *
     * Country is decided once at [initialize] (order: [InitOptions.localeOverride] → device
     * region [com.mobilebytelabs.paycraft.platform.PlatformInfo.country] → cloud
     * [com.mobilebytelabs.paycraft.config.SuiteConfig.locale] → "US"). Currency is the one the
     * cloud resolved for that locale (uniform across products). Prefer this over reasoning
     * about currency per-plan or per-provider.
     */
    val activeRegion: ResolvedRegion get() = ResolvedRegion(_activeCountry, _activeCurrency)

    /** ISO 3166-1 alpha-2 country driving price/currency resolution. See [activeRegion]. */
    val activeCountry: String get() = _activeCountry

    /** ISO 4217 currency the displayed price + every provider checkout share. See [activeRegion]. */
    val activeCurrency: String get() = _activeCurrency

    /**
     * Boot the SDK with a publishable PayCraft API key.
     *
     * @param apiKey   Publishable key from your PayCraft dashboard (`pk_test_…` or `pk_live_…`).
     * @param backend  Where to fetch SuiteConfig — defaults to PayCraft Cloud. Self-hosted
     *                 customers pass [PayCraftBackend.SelfHosted]; test code passes
     *                 [PayCraftBackend.Mock] with a static [SuiteConfig].
     * @param options  Optional locale override, cache-skip, and debug logging toggle.
     * @param mode     The default monetization policy (AC-9). [MonetizationMode.AdSupported]
     *                 keeps the paywall manual/contextual and exposes [isAdFree] for host
     *                 ad-gating; [MonetizationMode.TrialManaged] auto-presents the paywall
     *                 on [onAppOpen] while a trial is active or just ended. Overridable by
     *                 cloud [SuiteConfig.mode] — cloud wins when present (same precedence as
     *                 the theme pipeline). Trailing param with a default so every existing
     *                 caller (positional or named) keeps compiling unchanged.
     */
    fun initialize(
        apiKey: String,
        backend: PayCraftBackend = PayCraftBackend.Cloud,
        options: InitOptions = InitOptions(),
        mode: MonetizationMode = MonetizationMode.AdSupported,
    ) {
        require(apiKey.startsWith("pk_test_") || apiKey.startsWith("pk_live_") || backend is PayCraftBackend.Mock) {
            "apiKey must start with pk_test_ or pk_live_"
        }
        this.apiKey = apiKey
        this.backend = backend
        this.initOptions = options
        // Capture the init-flag AND resolve against whatever SuiteConfig the previous
        // process/session left in _suiteConfigFlow (usually null at cold start; a cached
        // config in the same process re-boot wins immediately). applySuiteConfig() will
        // re-resolve every subsequent fresh config landing, so a dashboard flip mid-run
        // takes effect on the next cloud fetch without waiting for the next initialize().
        this.initialMonetizationMode = mode
        this.resolvedMonetizationMode = MonetizationModeResolver.resolve(mode, _suiteConfigFlow.value?.mode)
        // Reset the presentation signal to Hidden — a stale Shown from the previous
        // process boot would otherwise pop the paywall back up before the host had
        // a chance to observe. onAppOpen()/presentPaywall() will re-emit as needed.
        _paywallPresentation.value = PaywallPresentation.Hidden
        // Do NOT reset SessionDebounce here — initialize() may be called multiple times
        // in an SDK re-init flow (rare, but supported for testing), and the once-per-
        // session semantics must survive across those re-inits so the buyer doesn't see
        // the auto-present paywall twice in one process. Debounce clears only on process
        // death (the natural session boundary) or explicitly via SessionDebounce test helpers.
        // Decide the billing country ONCE — the single deciding point that drives the /config
        // locale, the displayed price, and every provider's checkout currency. Override wins,
        // else the device region, else "US". The STORE STOREFRONT (the true billing region) is a
        // suspend read on the native client, so it can't be resolved here in the synchronous
        // initialize(); it is folded in at fetch time (see fetchAndApplySuiteConfig, where the
        // country is re-resolved with the storefront before the /config request). (PlatformInfo
        // reads can throw in odd test harnesses — same guard as the device fingerprint below.)
        this._activeCountry = CurrencyResolver.resolveCountry(
            override = options.localeOverride,
            storeStorefront = null,
            deviceCountry = runCatching { PlatformInfo.country }.getOrNull(),
            configLocale = null,
        )
        PayCraftLogger.onInitialize(
            backendName = when (backend) {
                is PayCraftBackend.Cloud -> "cloud"
                is PayCraftBackend.SelfHosted -> "self-hosted:${backend.supabaseUrl}"
                is PayCraftBackend.Mock -> "mock"
            },
            apiKeyPrefix = apiKey.substringBefore('_', "?") + "_…",
            debug = options.debug,
        )
        // Eagerly log the resolved mode + device fingerprint for debug visibility.
        // Wrap in try/catch — fingerprint computation reads the Android Context
        // which is normally set by androidx-startup but may not be ready in
        // unusual test harnesses.
        runCatching {
            PayCraftLogger.onFlow("initialize", "mode = $mode  device_id = $deviceId")
        }
        if (backend is PayCraftBackend.Mock) {
            applySuiteConfig(backend.staticConfig)
        } else {
            // Populate a placeholder config synchronously so requireConfig()
            // never throws between initialize() and the async cloud fetch
            // completing. UI composables (PayCraftBanner, paywalls) and Koin
            // singletons can read empty plans/benefits as a "loading" state
            // and react when applySuiteConfig() replaces them with the real
            // values from cloud.
            this.config = PayCraftConfig(
                supabaseUrl = backend.supabaseUrl,
                supabaseAnonKey = backend.supabaseAnonKey,
                provider = EmptyPaymentProvider,
                plans = emptyList(),
                benefits = emptyList(),
                supportEmail = "support@paycraft.mobilebytesensei.com",
                apiKey = apiKey,
                source = when (backend) {
                    is PayCraftBackend.Cloud -> ConfigSource.Cloud
                    is PayCraftBackend.SelfHosted -> ConfigSource.SelfHosted
                    is PayCraftBackend.Mock -> ConfigSource.Mock
                },
            )

            // Publish the last-known-good config from disk FIRST, synchronously. On repeat opens
            // the paywall Content branch then composes on its first frame and the skeleton never
            // appears; an offline launch still shows what the user could buy last time.
            //
            // This is what the SDK claimed to do and did not: the cache class existed but nothing
            // read or wrote it, so "warm cache" only ever held within a single process and every
            // first open of the day rendered the skeleton.
            applyCachedSuiteConfig()

            // Then revalidate from the backend's /config endpoint. Fire-and-forget — initialize()
            // returns immediately without awaiting the network round-trip; a genuinely cold cache
            // sees the layout-matched PaywallSkeleton exactly once until this republishes.
            configFetchJob?.cancel()
            configFetchJob = applicationScope.launch { prefetchProducts() }
        }
    }

    /**
     * Fire-and-forget products + config prefetch — the AC-8 warm-cache path. Called from
     * [initialize] inside an [applicationScope] launch so it never blocks initialize's return.
     * Writes through the existing SuiteConfig cache path so the paywall Content branch
     * renders on the first frame on repeat opens (no visible skeleton on warm cache).
     *
     * Public so hosts that want to explicitly warm the cache before opening the paywall
     * (a splash screen, a home-tab prefetch) can invoke it as a suspend function — the
     * initialize() call itself is fire-and-forget and never awaits this.
     */
    suspend fun prefetchProducts() {
        val key = apiKey ?: return
        if (backend is PayCraftBackend.Mock) return
        fetchAndApplySuiteConfig(key, backend, initOptions)
    }

    /**
     * Force a fresh SuiteConfig fetch from the backend, bypassing any in-flight
     * job, and publish it through [suiteConfigFlow]. Call this to pick up a
     * dashboard change without waiting for the next cold launch — e.g. on app
     * foreground or a pull-to-refresh. No-op for [PayCraftBackend.Mock] and before
     * [initialize].
     */
    fun refreshConfig() {
        val key = apiKey ?: return
        if (backend is PayCraftBackend.Mock) return
        configFetchJob?.cancel()
        configFetchJob = applicationScope.launch {
            fetchAndApplySuiteConfig(key, backend, initOptions)
        }
    }

    /**
     * Hit `backend.configUrl` for the SuiteConfig, decode, and publish via
     * [applySuiteConfig]. Inline HTTP fetch — bypasses [com.mobilebytelabs.paycraft.config.ConfigClient]
     * to avoid the [com.russhwolf.settings.Settings] dependency that needs a
     * platform-injected Context on Android. Persistent cache is a TODO once we
     * accept a Settings via initialize() options.
     */
    private suspend fun fetchAndApplySuiteConfig(apiKey: String, backend: PayCraftBackend, options: InitOptions) {
        val http = configHttpClient()
        try {
            // Re-resolve the country HERE (async fetch time), not the value cached in
            // initialize(). The Android Context that backs SIM-country detection is wired by
            // androidx-startup and — when the host starts Koin via koin-androidx-startup —
            // may not be ready during the synchronous initialize() call (startup ordering
            // race). Reading PlatformInfo.country at fetch time, after app init settles, picks
            // up the real billing region (e.g. an Indian SIM under an en-GB phone language).
            //
            // Prefer the STORE STOREFRONT over the device locale: the storefront is where the
            // user's Play/Apple payment account lives (the true billing region), so an India buyer
            // on an en-GB phone resolves to "IN" (₹) rather than "GB" (£). storefrontCountry() is a
            // native-store suspend read → null on web-checkout platforms, then device/cloud/US.
            val storefront = runCatching { nativeBillingClientOrNull()?.storefrontCountry() }.getOrNull()
            _activeCountry = CurrencyResolver.resolveCountry(
                override = options.localeOverride,
                storeStorefront = storefront,
                deviceCountry = runCatching { PlatformInfo.country }.getOrNull(),
                configLocale = null,
            )
            val locale = _activeCountry
            PayCraftLogger.onFlow(
                "loadConfig",
                "GET ${backend.configUrl}?apiKey=${apiKey.take(8)}…  mode=$mode  country=$locale",
            )
            // Supabase Edge Functions require an Authorization header by default
            // (verify_jwt=true at the platform level). Pass the backend's known
            // anon key — same value the SDK uses for the postgrest data plane.
            // Test/live duality is resolved server-side from the apiKey prefix —
            // server returns mode-appropriate payment_links + webhook routes.
            val response: HttpResponse = http.get(backend.configUrl) {
                parameter("apiKey", apiKey)
                header("Authorization", "Bearer ${backend.supabaseAnonKey}")
                header("apikey", backend.supabaseAnonKey)
                header("Accept-Language", "en-$locale")
                // Platform drives per-platform provider ordering server-side (migration 075): the
                // `/config` edge function orders providers[] by the tenant's routing rule for this
                // platform, so [primaryProvider] is the tenant's intended provider per platform.
                header("X-PayCraft-Platform", runCatching { PlatformInfo.platform.lowercase() }.getOrDefault(""))
            }
            if (!response.status.isSuccess()) {
                // Previously this logged "paywall stays in loading state" and bare-returned, which
                // is exactly what it said: _suiteConfigFlow was never written, so the composable's
                // `config == null` gate held PaywallSkeleton forever. Now the request falls through
                // the remaining layers and, whatever they yield, the UI is told what happened.
                PayCraftLogger.onError(
                    "loadConfig",
                    "cloud fetch HTTP ${response.status.value} — falling back through the resilience chain",
                )
                fallBackThroughChain(
                    ConfigResult.Failed.Reason.HTTP_ERROR,
                    "HTTP ${response.status.value}",
                )
                return
            }
            val raw: String = response.body()
            val json = Json {
                ignoreUnknownKeys = true
                isLenient = true
                // An explicit `null` for a non-nullable field with a default falls back to that
                // default. kotlinx applies a default ONLY when the key is ABSENT, so an explicit
                // `"template": null` throws — and the config endpoint sends explicit nulls for every
                // unset column of a tenant that has not finished configuring its paywall
                // (`tenant_id`, `template`, `theme_jsonb`, `branding` …). Without this, a brand-new
                // tenant's config failed to decode ENTIRELY and fell through every resilience layer
                // to "Something went wrong" on the first paywall its owner ever opened.
                coerceInputValues = true
            }
            val cfg = json.decodeFromString(SuiteConfig.serializer(), raw)
                .copy(fetchedAtEpochMillis = currentTimeMillis())
            // Fold the server's edge IP-geo (cfg.geoCountry) into the unified country resolution.
            // It beats the device locale but NOT the store storefront — recomputed here so a
            // web/desktop buyer (no storefront) resolves to the authoritative server country
            // instead of only the device locale. Pre-fetch resolution (above) had no server signal.
            _activeCountry = CurrencyResolver.resolveCountry(
                override = options.localeOverride,
                storeStorefront = storefront,
                deviceCountry = runCatching { PlatformInfo.country }.getOrNull(),
                configLocale = cfg.locale,
                serverGeo = cfg.geoCountry,
            )
            applySuiteConfig(cfg)
            _configResultFlow.value = ConfigResult.Fresh(cfg)
            // Persist for the NEXT cold start. Without this the "warm cache skips the skeleton"
            // path only held within a single process: every first open of the day showed the
            // skeleton, and a launch with no network rendered no products at all.
            configCacheOrNull()?.let { runCatching { it.write(cfg) } }
            PayCraftLogger.onFlow("loadConfig", "cloud fetch ok — ${cfg.products.size} products")
            // Now that products (and their store product ids) are loaded, ask the native store for
            // its OWN localized price per product and re-apply so the paywall shows the store truth
            // (e.g. ₹799 from the IN storefront) instead of the cloud /config price. No-op on
            // web-checkout platforms (WebCheckoutNativeBillingClient returns null).
            resolveAndApplyNativePrices(cfg)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            PayCraftLogger.onError("loadConfig", e.message)
            // A transport failure and a malformed payload need different words in the UI: one is
            // "you appear to be offline, try again", the other is "something is wrong on our side".
            // Offering retry for the second would be a lie.
            val reason = if (e is SerializationException) {
                ConfigResult.Failed.Reason.DECODE_ERROR
            } else {
                ConfigResult.Failed.Reason.OFFLINE
            }
            fallBackThroughChain(reason, e.message)
        }
        // NOTE: deliberately no http.close() here — the client is process-scoped and shared (see
        // [configHttpClient]). It is closed once, in [shutdown].
    }

    /**
     * The ONE HTTP client every config fetch uses.
     *
     * Previously each fetch built and tore down its own client. That was correct (it closed in a
     * `finally`) but wasteful: a fresh engine and connection pool per call, so no connection reuse
     * across fetches. Realtime made that matter — a config ping triggers a refetch, so an active
     * dashboard editing session churned one engine per save. Prefers the Koin singleton and falls
     * back to a locally-owned client for callers that fetch before the graph is up.
     */
    private fun configHttpClient(): HttpClient {
        KoinPlatform.getKoinOrNull()?.getOrNull<HttpClient>()?.let { return it }
        return ownedHttpClient ?: HttpClient {
            install(ContentNegotiation) {
                json(
                    Json {
                        ignoreUnknownKeys = true
                        explicitNulls = false
                        isLenient = true
                    },
                )
            }
        }.also { ownedHttpClient = it }
    }

    /** Non-null only when the SDK had to build its own client (Koin not yet available). */
    private var ownedHttpClient: HttpClient? = null

    /**
     * How long a config ping waits before refetching, so a burst of dashboard saves (each firing
     * its own broadcast) collapses into ONE fetch instead of N racing ones. Short enough that an
     * edit still feels live.
     */
    private const val CONFIG_PING_DEBOUNCE_MS = 400L

    /**
     * The persistent [ConfigCache], or null when no [com.russhwolf.settings.Settings] is available.
     *
     * `ConfigCache` shipped long before this and was never wired to anything — the inline fetch
     * carried a "persistent cache is a TODO" note and decoded straight into memory. So the SDK had
     * an offline story on paper and none in practice.
     */
    /**
     * Last successfully-resolved ConfigCache.
     *
     * The lookup goes through Koin, which is not guaranteed to be up at every moment this is
     * called — the graph may not have started yet at cold launch, and a host that tears it down
     * (or a test that stops it) makes a previously-working lookup start returning null. Losing the
     * reference means the resilience chain silently skips layer 2 and serves a bundled or built-in
     * paywall to a user whose own cached config was sitting right there.
     *
     * Holding the first successful resolution costs one reference and removes that whole class of
     * timing-dependent behaviour.
     */
    private var memoizedConfigCache: ConfigCache? = null

    private fun configCacheOrNull(): ConfigCache? {
        memoizedConfigCache?.let { return it }
        val resolved = runCatching { KoinPlatform.getKoinOrNull()?.getOrNull<ConfigCache>() }.getOrNull()
        if (resolved != null) memoizedConfigCache = resolved
        return resolved
    }

    /**
     * Publish the last-known-good config from disk, synchronously, before any network call.
     *
     * Turns a cold start into a warm one: the paywall renders real products on its first frame
     * instead of a skeleton, and an app launched with no connectivity still shows what the user
     * could buy last time. The cloud fetch continues in the background and republishes.
     *
     * Never overwrites a config already resolved this process — a live value always wins over disk.
     */
    /**
     * Layers 2 → 3 → 4 of the resilience chain, run when the network layer did not answer.
     *
     * Order is deliberate and each step is strictly weaker than the one before:
     *   2. PERSISTED CACHE — real data this user actually saw, possibly past its TTL.
     *   3. BUNDLED FALLBACK — real data the developer shipped, but never user-specific.
     *   4. BUILT-IN — no data; render a minimal purchasable surface so a paying user can still pay.
     *
     * If even layer 4 has nothing to price, the result is [ConfigResult.Failed] — terminal, and
     * carrying the reason so the UI can say something true rather than spin.
     *
     * This function must not throw. It runs on the failure path, and an exception here would strand
     * the very user it exists to rescue.
     */
    /**
     * Clears the resolved-config state so a test can exercise a cold chain.
     *
     * `internal`, so it is not part of the public SDK surface. It exists because PayCraft is an
     * `object`: `_suiteConfigFlow` survives between tests, and layer 4 legitimately answers
     * BuiltIn whenever ANY product is already known — which made the terminal Failed branch
     * unreachable in a suite rather than genuinely absent. Weakening the assertion instead would
     * have left the branch untested while looking green.
     */
    internal fun resetConfigStateForTesting() {
        _suiteConfigFlow.value = null
        _configResultFlow.value = ConfigResult.Loading
        memoizedConfigCache = null
    }

    private fun fallBackThroughChain(reason: ConfigResult.Failed.Reason, detail: String?) {
        // ── Layer 2: persisted cache ────────────────────────────────────────────────────────
        // NOTE this is NOT applyCachedSuiteConfig(): that one returns early when a config is
        // already present, because its job is a cold-start warm-up. Here we WANT the cache even if
        // something is loaded, since what is loaded may be the thing that just failed to refresh.
        val cached = runCatching { configCacheOrNull()?.read() }.getOrNull()
        if (cached != null) {
            applySuiteConfig(cached)
            // ConfigCache.read() signals expiry by handing back a copy with cacheTtlSeconds = 0.
            val stale = cached.cacheTtlSeconds == 0
            _configResultFlow.value = if (stale) {
                val ageSec = (currentTimeMillis() - cached.fetchedAtEpochMillis) / 1000
                PayCraftLogger.onFlow("loadConfig", "serving STALE cache — ${ageSec}s old")
                ConfigResult.Stale(cached, ageSec)
            } else {
                PayCraftLogger.onFlow("loadConfig", "serving cache — ${cached.products.size} products")
                ConfigResult.Cached(cached)
            }
            return
        }

        // ── Layer 3: bundled fallback shipped in the app binary ─────────────────────────────
        val bundledJson = runCatching { readBundledSuiteConfigJsonOrNull() }.getOrNull()
        if (!bundledJson.isNullOrBlank()) {
            val bundled = runCatching {
                Json { ignoreUnknownKeys = true; isLenient = true; coerceInputValues = true }
                    .decodeFromString(SuiteConfig.serializer(), bundledJson)
            }.getOrNull()
            if (bundled != null) {
                applySuiteConfig(bundled)
                _configResultFlow.value = ConfigResult.Bundled(bundled)
                PayCraftLogger.onFlow("loadConfig", "serving BUNDLED fallback — ${bundled.products.size} products")
                return
            }
            // A malformed bundled file is a developer error worth surfacing, but not worth
            // aborting the chain for — layer 4 still gives the user somewhere to go.
            PayCraftLogger.onError("loadConfig", "bundled fallback present but failed to decode")
        }

        // ── Layer 4: built-in ───────────────────────────────────────────────────────────────
        // Only honest when there is something purchasable to name. Otherwise the truthful answer
        // is Failed, and a paywall pretending to sell nothing would be worse than an error.
        val known = _suiteConfigFlow.value?.products.orEmpty()
        if (known.isNotEmpty()) {
            _configResultFlow.value = ConfigResult.BuiltIn
            PayCraftLogger.onFlow("loadConfig", "serving BUILT-IN paywall — ${known.size} known products")
            return
        }

        _configResultFlow.value = ConfigResult.Failed(reason, detail)
        PayCraftLogger.onError("loadConfig", "all resilience layers exhausted — $reason ${detail ?: ""}")
    }

    private fun applyCachedSuiteConfig() {
        if (_suiteConfigFlow.value != null) return
        val cached = configCacheOrNull()?.let { runCatching { it.read() }.getOrNull() } ?: return
        applySuiteConfig(cached)
        // Publish the layer as well as the data: a warm start from an EXPIRED cache still renders,
        // but the user should be told the prices may have moved rather than shown stale numbers as
        // though they were fresh. The in-flight refresh will overwrite this with Fresh if it lands.
        _configResultFlow.value = if (cached.cacheTtlSeconds == 0) {
            ConfigResult.Stale(cached, (currentTimeMillis() - cached.fetchedAtEpochMillis) / 1000)
        } else {
            ConfigResult.Cached(cached)
        }
        PayCraftLogger.onFlow(
            "loadConfig",
            "warm start from persisted cache — ${cached.products.size} products (revalidating)",
        )
    }

    /** The Koin-resolved native billing client (Play on Android / StoreKit2 on iOS), or null. */
    private fun nativeBillingClientOrNull(): NativeBillingClient? =
        runCatching { KoinPlatform.getKoinOrNull()?.getOrNull<NativeBillingClient>() }.getOrNull()

    /**
     * The store product id for [product] on the ACTIVE native lane — Play `play_product_id` on
     * Android, App Store `app_store_product_id` on iOS. Null on web-checkout platforms or when the
     * dashboard did not configure a native id (→ no native price, cloud price is used).
     */
    private fun storeProductIdFor(product: ProductDto): String? = when (PlatformInfo.platform.lowercase()) {
        "android" -> product.playProductId
        "ios" -> product.appStoreProductId
        else -> null
    }?.takeIf { it.isNotBlank() }

    /**
     * Ask the native store for each product's OWN localized price (Play `formattedPrice` /
     * StoreKit `displayPrice`), keyed by plan sku, then re-apply the suite so the paywall re-emits
     * with the store truth (the USD/₹ the store will actually charge) instead of the cloud price.
     *
     * USD/cloud fallback is automatic: any product with no native id, or that the store can't
     * price (unresolved storefront/product), is simply absent from the map → [toBillingPlans]
     * keeps its cloud-resolved price (which already falls back to the USD base currency).
     */
    private suspend fun resolveAndApplyNativePrices(suite: SuiteConfig) {
        val client = nativeBillingClientOrNull() ?: return
        val prices = mutableMapOf<String, NativeDisplayPrice>()
        for (product in suite.products) {
            val storeProductId = storeProductIdFor(product) ?: continue
            val native = runCatching { client.nativeDisplayPrice(storeProductId) }.getOrNull() ?: continue
            prices[product.sku] = native
        }
        if (prices.isNotEmpty()) {
            nativePricesBySku = prices
            // Re-apply the SAME suite: rebuilds config.plans with native prices and re-emits the
            // flow so the collecting paywall ViewModel recomposes with the store-localized price.
            applySuiteConfig(suite)
            PayCraftLogger.onFlow("loadConfig", "native store prices applied for ${prices.size} products")
        }
    }

    /** The native store's localized price for a plan sku, if resolved. See [displayPrice] wiring. */
    internal fun nativePriceForSku(sku: String): NativeDisplayPrice? = nativePricesBySku[sku]

    /**
     * Empty PaymentProvider used as a placeholder when [config] is populated
     * synchronously by [initialize] before the async cloud fetch completes.
     * Calls into checkout/manage URLs throw clear errors — the UI should
     * gate those interactions on a non-empty [plans] list anyway.
     */
    private object EmptyPaymentProvider : com.mobilebytelabs.paycraft.provider.PaymentProvider {
        override val name: String = "loading"
        override fun getCheckoutUrl(plan: com.mobilebytelabs.paycraft.model.BillingPlan, email: String?): String =
            error("PayCraft cloud config not loaded yet — wait for plans to be fetched before checkout")
        override fun getManageUrl(email: String): String? = null
        override val webhookFunctionName: String = "none"
    }

    /** Apply a cloud-fetched [SuiteConfig] into the existing PayCraftConfig shape. */
    internal fun applySuiteConfig(suite: SuiteConfig) {
        // Resolve + assign `config` BEFORE emitting on the flow. The paywall ViewModel
        // collects suiteConfigFlow and re-reads PayCraft.config on each emission; if the
        // emit came first, the collector could run while `config` still held the previous
        // value (null on cold start) and drop the plans — and it would never re-fire,
        // because the StateFlow value wouldn't change again. Config-first ordering
        // guarantees every collector observes the freshly-resolved config.
        currentSuite = suite
        val resolved = suite.toPayCraftConfig(backend, apiKey, nativePricesBySku)
        this.config = resolved
        // The cloud resolved prices for the active locale; capture the single currency every
        // provider + the displayed price now share (uniform across products for a locale).
        _activeCurrency = CurrencyResolver.resolveCurrency(resolved.plans)
        // Config-wins precedence for the monetization mode (AC-9): whenever a fresh
        // SuiteConfig lands, re-resolve against the host-supplied init flag so a
        // dashboard flip ("ad_supported" ↔ "trial_managed") takes effect on the next
        // cloud fetch without a host rebuild. Null cloud value (no `mode` field in
        // this tenant's response yet) leaves the init flag in charge — additive/safe.
        resolvedMonetizationMode = MonetizationModeResolver.resolve(initialMonetizationMode, suite.mode)
        _suiteConfigFlow.value = suite
        PayCraftLogger.onSuiteConfigApplied(
            source = resolved.source.name,
            productCount = suite.products.size,
            providerCount = suite.providers.size,
            primaryProvider = suite.providers.firstOrNull()?.provider ?: "none",
            locale = suite.locale,
        )
        // The single resolved region every provider + the displayed price now share.
        PayCraftLogger.onFlow(
            "loadConfig",
            "active region → country=$_activeCountry currency=$_activeCurrency",
        )
        // Now that tenant_id is known, wire realtime push: a `config:{tenant}` ping
        // refetches /config (kills the cache-TTL lag), an `entitlement:{tenant}:{user}`
        // ping force-refreshes status. Additive over the existing TTL/foreground sync.
        startRealtime(suite.tenantId)
    }

    /**
     * Subscribe the SDK to its realtime broadcast channels (best-effort; failures
     * leave the TTL/foreground sync as the fallback). Idempotent — safe to call on
     * every config apply; the realtime client no-ops when already subscribed and
     * re-subscribes the entitlement channel when the buyer's identity changes.
     */
    private fun startRealtime(tenantId: String) {
        val koin = KoinPlatform.getKoinOrNull() ?: return
        val realtime = koin.getOrNull<PayCraftRealtime>() ?: return
        realtime.ensureConfigChannel(tenantId) {
            // Cancel first — refreshConfig() has always done this, the ping path never did, so a
            // burst of dashboard saves left parallel fetches racing to publish onto the same
            // StateFlow and the paywall could settle on the LOSER's (stale) payload.
            // The small debounce collapses that burst into one refetch.
            configFetchJob?.cancel()
            configFetchJob = applicationScope.launch {
                delay(CONFIG_PING_DEBOUNCE_MS)
                runCatching { prefetchProducts() }
            }
        }
        refreshRealtimeIdentity()
    }

    /**
     * (Re)bind the realtime ENTITLEMENT channel to the CURRENT buyer identity
     * (`email ?: deviceId`). Called on every config apply AND by [BillingManager]
     * whenever the identity changes — login (device-id → email) and logout
     * (email → device-id) — so an entitlement push always reaches the buyer's
     * channel. The realtime client removes the prior channel before subscribing
     * the new one, so the old user's pings stop after logout. No-op until a
     * SuiteConfig (hence tenant_id) has landed. Best-effort; failures leave the
     * TTL/foreground sync as the fallback.
     */
    /**
     * Force the realtime channels to rebuild — called on app foreground.
     *
     * Best-effort and safe to call when realtime was never started; the TTL/foreground sync
     * remains the fallback either way.
     */
    internal fun resubscribeRealtime() {
        val koin = KoinPlatform.getKoinOrNull() ?: return
        runCatching { koin.getOrNull<PayCraftRealtime>()?.resubscribe() }
    }

    internal fun refreshRealtimeIdentity() {
        val tenantId = suiteConfig?.tenantId ?: return
        val koin = KoinPlatform.getKoinOrNull() ?: return
        val realtime = koin.getOrNull<PayCraftRealtime>() ?: return
        applicationScope.launch {
            val email = runCatching { koin.getOrNull<PayCraftStore>()?.getEmail() }.getOrNull()
            val appUserId = email?.trim()?.lowercase()?.ifBlank { null } ?: deviceId
            val billing = koin.getOrNull<BillingManager>()
            realtime.ensureEntitlementChannel(tenantId, appUserId) {
                billing?.refreshStatus(force = true)
            }
        }
    }

    fun requireConfig(): PayCraftConfig = config ?: error("PayCraft.initialize(apiKey) must be called before use")

    /**
     * Coupons the customer has successfully applied this session.
     * Keyed by plan id (= product sku) so each plan can hold at most one coupon.
     * Populated by [setAppliedCoupon] — typically driven by the paywall's coupon
     * input field after a successful [com.mobilebytelabs.paycraft.network.CouponClient.validate].
     */
    internal val appliedCoupons: MutableMap<String, CouponDto> = mutableMapOf()

    /**
     * Record a coupon the customer just typed at the paywall. The next
     * [checkout] call for this plan will append the promotion code to the
     * provider's checkout URL (Stripe `prefilled_promo_code=…`).
     *
     * Pass `null` to clear. Recurring subscriptions DO NOT need re-validation —
     * Stripe attaches the Coupon to the Subscription itself and applies it per
     * the coupon's `duration` (once / repeating / forever) for every renewal.
     */
    fun setAppliedCoupon(planId: String, coupon: CouponDto?) {
        if (coupon == null) appliedCoupons.remove(planId) else appliedCoupons[planId] = coupon
    }

    private val couponClient: CouponClient by lazy {
        CouponClient(
            httpClient = HttpClient {
                install(ContentNegotiation) {
                    json(
                        Json {
                            ignoreUnknownKeys = true
                            explicitNulls = false
                        },
                    )
                }
            },
            backend = backend,
        )
    }

    /**
     * Validate a customer-typed promo code for the given plan.
     *
     * On success the resolved [CouponDto] is stashed in [appliedCoupons]
     * automatically — the very next [checkout] call appends the code to the
     * provider URL so Stripe (or Razorpay) applies the discount at the checkout
     * screen and persists it on the resulting Subscription for recurring renewals.
     *
     * Returns [CouponClient.Result.Ok], [Invalid] (no such code / expired /
     * doesn't apply to this product), or [Error] (network / config issues).
     */
    suspend fun applyCoupon(planId: String, code: String): CouponClient.Result {
        val suite =
            suiteConfig ?: return CouponClient.Result.Error("PayCraft.initialize() not finished — no SuiteConfig yet")
        val key = apiKey ?: return CouponClient.Result.Error("PayCraft.initialize(apiKey) was not called")
        val product = suite.products.firstOrNull { it.sku == planId }
            ?: return CouponClient.Result.Invalid("Plan $planId not found in cloud config")
        val result = couponClient.validate(apiKey = key, code = code, productId = product.id)
        if (result is CouponClient.Result.Ok) {
            setAppliedCoupon(planId, result.coupon)
        }
        return result
    }

    /**
     * Start checkout for [plan].
     *
     * Store-compliance routing (Payments policy): on **Android** for a **digital** product the
     * checkout transacts through **Google Play Billing** ([BillingManager.purchaseViaPlayBilling]),
     * and on **iOS/macOS** through **Apple StoreKit** ([BillingManager.purchaseViaStoreKit], Apple
     * Guideline 3.1.1) — it NEVER opens an external Stripe/Razorpay web payment page (the Play "leads
     * users to a payment method other than Google Play's billing system" / the Apple 3.1.1 "digital
     * subscription must use IAP" violations). On a platform with no native store (web/desktop) — or a
     * genuinely physical product — it keeps the existing web-link path. The lane is decided by
     * [resolveCheckoutLane], the single unit-tested decision point.
     */
    fun checkout(plan: BillingPlan, email: String? = null) {
        when (val lane = resolveCheckoutLane(PlatformInfo.platform, plan)) {
            is CheckoutLane.Web -> {
                val baseUrl = requireConfig().provider.getCheckoutUrl(plan, email)
                val url = appendCouponParam(baseUrl, appliedCoupons[plan.id]?.code)
                PayCraftPlatform.openUrl(url)
            }
            // NativePlay/NativeStoreKit/Misconfigured all delegate to the billing manager: it
            // purchases via the store lane, or (misconfigured product id) sets BillingState.Error
            // WITHOUT ever opening the browser — the anti-steering guarantee on both stores.
            is CheckoutLane.NativePlay,
            is CheckoutLane.NativeStoreKit,
            is CheckoutLane.Misconfigured,
            ->
                routeNativeDigital(plan, email, lane)
        }
    }

    /**
     * Checkout via a specific provider picked by the user in `ProviderBottomSheet`.
     * Used by the multi-provider flow; single-provider apps use [checkout] instead.
     *
     * Applies the SAME store-compliance routing as [checkout]: on Android+digital the purchase goes
     * through Google Play Billing and on iOS/macOS+digital through StoreKit — the provider pick is
     * irrelevant on a native store, never the web link.
     */
    internal fun checkoutWithProvider(plan: BillingPlan, provider: ProviderDto, email: String? = null) {
        when (val lane = resolveCheckoutLane(PlatformInfo.platform, plan)) {
            is CheckoutLane.Web -> {
                val adapter = SuiteProviderAdapter(provider)
                val baseUrl = adapter.getCheckoutUrl(plan, email)
                val url = appendCouponParam(baseUrl, appliedCoupons[plan.id]?.code)
                PayCraftPlatform.openUrl(url)
            }
            is CheckoutLane.NativePlay,
            is CheckoutLane.NativeStoreKit,
            is CheckoutLane.Misconfigured,
            ->
                routeNativeDigital(plan, email, lane)
        }
    }

    /**
     * Hand a native digital checkout to the store's in-app billing via the Koin-resolved
     * [BillingManager] — Google Play Billing on Android ([BillingManager.purchaseViaPlayBilling]) or
     * StoreKit on iOS/macOS ([BillingManager.purchaseViaStoreKit], Apple Guideline 3.1.1). The
     * manager owns the billing-state flow the paywall observes (Loading → Success/Cancelled/Error) and
     * enforces the anti-steering guard (blank product id → error, never a browser fallback). A
     * [CheckoutLane.Misconfigured] is dispatched to the platform-appropriate lane so it fails closed
     * with the correct store message — never a web fallback.
     */
    private fun routeNativeDigital(plan: BillingPlan, email: String?, lane: CheckoutLane) {
        val billingManager = KoinPlatform.getKoinOrNull()?.getOrNull<BillingManager>()
        if (billingManager == null) {
            // No Koin graph (should never happen in a real app — the paywall itself is Koin-resolved).
            // Fail CLOSED: log and stop. We deliberately do NOT open the browser here — that would be
            // the exact anti-steering violation we are preventing.
            PayCraftLogger.onError(
                "checkout",
                "native digital checkout for ${plan.id} but no BillingManager in the Koin graph — " +
                    "load PayCraftModule + the platform billing module. Refusing web fallback (anti-steering).",
            )
            return
        }
        when (lane) {
            is CheckoutLane.NativePlay -> billingManager.purchaseViaPlayBilling(plan, email)
            is CheckoutLane.NativeStoreKit -> billingManager.purchaseViaStoreKit(plan, email)
            is CheckoutLane.Misconfigured -> {
                PayCraftLogger.onError("checkout", "${lane.reason} for plan ${plan.id} (native digital)")
                // Fail closed through the platform-appropriate lane so the anti-steering guard sets
                // BillingState.Error with the right store message — never a web fallback.
                val platform = PlatformInfo.platform
                if (platform.equals("ios", ignoreCase = true) || platform.equals("macos", ignoreCase = true)) {
                    billingManager.purchaseViaStoreKit(plan, email)
                } else {
                    billingManager.purchaseViaPlayBilling(plan, email)
                }
            }
            is CheckoutLane.Web -> Unit // unreachable — Web is handled by the caller's when-branch.
        }
    }

    /**
     * Append a Stripe/Razorpay-compatible promotion code parameter to a checkout
     * URL. Stripe Payment Links honour `prefilled_promo_code` when the link was
     * created with `allow_promotion_codes=true` (which PayCraft's product-sync
     * code does by default). Razorpay subscription links accept `?promotion=`
     * (best-effort; ignored if the offer isn't whitelisted).
     */
    private fun appendCouponParam(url: String, code: String?): String {
        if (code.isNullOrBlank()) return url
        val sep = if (url.contains('?')) '&' else '?'
        return "$url${sep}prefilled_promo_code=$code"
    }

    fun manageSubscription(email: String) {
        val url = requireConfig().provider.getManageUrl(email)
        PayCraftLogger.onManageSubscription(mode = "cloud", url = url)
        if (url != null) PayCraftPlatform.openUrl(url)
    }

    // ─── Phase-4 paywall-presentation API (AC-10, AC-11, AC-12) ─────────────
    //
    // The two present APIs are ALWAYS public regardless of the resolved monetization
    // mode — per the union design in GOAL.md D3 the host may call either per-call
    // (a TrialManaged host can still trigger a contextual manual paywall; an
    // AdSupported host can still call presentPaywallIfNeeded to gate the paywall
    // on entitlement). Both dispatch through the same reactive [paywallPresentation]
    // StateFlow so a host's compose tree observing the flow will render the paywall
    // in a sheet identically for every trigger.

    /**
     * Present the paywall NOW — the manual/contextual entry point (AC-10). Always
     * public regardless of [monetizationMode]. Hosts call this from a "get premium"
     * button, a post-ad interstitial, a "download in HD" upsell, etc.
     *
     * Sets [paywallPresentation] to [PaywallPresentation.Shown] with the [Manual]
     * trigger — hosts observing the flow render [com.mobilebytelabs.paycraft.ui.PayCraftPaywallComposable]
     * in a modal sheet on state=Shown, dismiss the sheet + call [dismissPaywall] on
     * user close. Idempotent: calling twice while already Shown re-emits the same
     * state (harmless — StateFlow deduplicates identical values).
     */
    fun presentPaywall() {
        PayCraftLogger.onFlow("presentPaywall", "manual — mode=$resolvedMonetizationMode")
        _paywallPresentation.value = PaywallPresentation.Shown(
            trigger = PaywallPresentation.Shown.Trigger.Manual,
        )
    }

    /**
     * Present the paywall ONLY if the buyer does not already hold [entitlement]
     * (AC-10). Always public regardless of [monetizationMode]. A no-op when the
     * entitlement is active — mirroring RevenueCat's `presentPaywallIfNeeded`.
     *
     * Today PayCraft models a single "premium" entitlement (see
     * [com.mobilebytelabs.paycraft.core.EntitlementSnapshot]) — [isAdFree] is the
     * observable truth for that entitlement, so any [entitlement] name resolves
     * through the same flag until multi-entitlement support lands (out of scope
     * for Phase 4). Passing `null` uses the default "premium" name explicitly for
     * clarity in the [PaywallPresentation.Shown.entitlement] field.
     *
     * @param entitlement Optional entitlement to check; defaults to the SDK's
     *                    single "premium" entitlement. Recorded on the emitted
     *                    [PaywallPresentation.Shown.entitlement] for analytics.
     */
    fun presentPaywallIfNeeded(entitlement: String? = null) {
        // Entitlement-active no-op path — the AC-10 assertion. AdFreeEntitlement is the
        // single source of truth for "user is paying" (updated on every onAppOpen and
        // by hosts pushing subscription refreshes), so `isAdFree.value == true` is the
        // authoritative "premium is active" signal.
        if (AdFreeEntitlement.isAdFree.value) {
            PayCraftLogger.onFlow(
                "presentPaywallIfNeeded",
                "no-op — entitlement ${entitlement ?: DEFAULT_ENTITLEMENT} already active",
            )
            return
        }
        PayCraftLogger.onFlow(
            "presentPaywallIfNeeded",
            "showing — entitlement ${entitlement ?: DEFAULT_ENTITLEMENT} not active",
        )
        _paywallPresentation.value = PaywallPresentation.Shown(
            trigger = PaywallPresentation.Shown.Trigger.IfNeeded,
            entitlement = entitlement ?: DEFAULT_ENTITLEMENT,
        )
    }

    /**
     * App-open dispatch entry point (AC-11, AC-12). Hosts call this from their
     * app lifecycle onResume/onCreate hook (Android Activity, iOS SceneDelegate).
     * The dispatch is mode-driven:
     *
     * ─ [MonetizationMode.TrialManaged]: auto-presents the paywall ONCE per
     *   process when the buyer is NOT already premium AND has an active or
     *   just-ended trial (the convert-or-churn moment) AND
     *   [SessionDebounce.APP_OPEN_KEY] is not yet marked. Marks the debounce on
     *   present so a rapid app-open cycle does not re-present.
     *
     * ─ [MonetizationMode.AdSupported]: never auto-presents (the manual
     *   [presentPaywall] path is the only paywall trigger). Updates the
     *   [AdFreeEntitlement] flag from [entitlement.isPremium] so the host's ad
     *   gating stays in sync with the current subscription status.
     *
     * In both modes the [AdFreeEntitlement] flag is updated up-front so a single
     * onAppOpen call is the "resync entitlement + maybe present" combined signal
     * regardless of mode.
     *
     * @param entitlement Snapshot of the buyer's subscription state — hosts
     *                    derive from [com.mobilebytelabs.paycraft.core.BillingManager.isPremium].
     * @param trial       Snapshot of the buyer's trial state — hosts derive from
     *                    [com.mobilebytelabs.paycraft.core.BillingManager.isInTrial] +
     *                    [com.mobilebytelabs.paycraft.core.BillingManager.trialEndsAt].
     */
    fun onAppOpen(entitlement: EntitlementSnapshot, trial: TrialSnapshot) {
        // Update the ad-free flag from the snapshot up-front — the host observes
        // this in AdSupported mode to gate ads (AC-12), and in TrialManaged mode
        // the same signal represents "user is premium, don't nag with the paywall".
        AdFreeEntitlement.set(entitlement.isPremium)
        when (resolvedMonetizationMode) {
            MonetizationMode.TrialManaged -> {
                // Never nag a paying user — premium takes precedence over trial state
                // (a premium user WHO STARTED FROM TRIAL still has premium=true).
                if (entitlement.isPremium) {
                    PayCraftLogger.onFlow("onAppOpen", "trialManaged skip — buyer is premium")
                    return
                }
                // Never nag a buyer who never had a trial (isActive=false AND hasEnded=false).
                // isActiveOrNearExpiry captures the two auto-present classes: active trial
                // (mid-trial nudge) OR just-ended trial (convert-or-churn moment).
                if (!trial.isActiveOrNearExpiry) {
                    PayCraftLogger.onFlow("onAppOpen", "trialManaged skip — no active/ended trial")
                    return
                }
                // Once-per-session debounce (AC-11): if the paywall was already auto-presented
                // this process, do not present again on a subsequent onAppOpen — a rapid
                // background/foreground cycle would otherwise re-open the paywall.
                if (SessionDebounce.wasShown(SessionDebounce.APP_OPEN_KEY)) {
                    PayCraftLogger.onFlow("onAppOpen", "trialManaged skip — already shown this session")
                    return
                }
                SessionDebounce.mark(SessionDebounce.APP_OPEN_KEY)
                PayCraftLogger.onFlow(
                    "onAppOpen",
                    "trialManaged auto-present — trial.isActive=${trial.isActive} " +
                        "hasEnded=${trial.hasEnded} daysRemaining=${trial.daysRemaining}",
                )
                _paywallPresentation.value = PaywallPresentation.Shown(
                    trigger = PaywallPresentation.Shown.Trigger.TrialManagedAppOpen,
                )
            }
            MonetizationMode.AdSupported -> {
                // No auto-present in AdSupported mode (AC-12). The AdFreeEntitlement update
                // above already reflected the buyer's premium status; the host reads it to
                // gate ads and calls presentPaywall() itself when it wants to upsell.
                PayCraftLogger.onFlow(
                    "onAppOpen",
                    "adSupported — isAdFree=${entitlement.isPremium} (host owns paywall trigger)",
                )
            }
        }
    }

    /**
     * Reset the paywall presentation signal back to [PaywallPresentation.Hidden].
     * Hosts call this from the modal sheet's dismiss handler so the flow observer
     * closes the sheet. Idempotent: calling twice while already Hidden is a no-op.
     */
    fun dismissPaywall() {
        _paywallPresentation.value = PaywallPresentation.Hidden
    }

    /** Default entitlement name used when [presentPaywallIfNeeded] is called without one. */
    private const val DEFAULT_ENTITLEMENT = "premium"
}

data class InitOptions(
    val localeOverride: String? = null, // ISO 3166-1 alpha-2; null = system locale
    val skipCache: Boolean = false,
    val debug: Boolean = false,
)

data class PayCraftConfig(
    val supabaseUrl: String,
    val supabaseAnonKey: String,
    val provider: PaymentProvider,
    val plans: List<BillingPlan>,
    val benefits: List<BillingBenefit>,
    val supportEmail: String,
    val apiKey: String? = null,
    val source: ConfigSource = ConfigSource.Cloud,
)

enum class ConfigSource { Cloud, SelfHosted, Mock }

/**
 * The tenant's PRIMARY provider for the active platform. The `/config` server orders
 * [SuiteConfig.providers] by the tenant's per-platform routing preference (migration 075), so the
 * SDK trusts that server order and takes the head rather than making its own arbitrary pick — a
 * "desktop → Stripe" tenant gets Stripe first on desktop, an "android → Razorpay" tenant gets
 * Razorpay first on Android. Returns null only when the tenant has zero enabled providers.
 */
internal fun SuiteConfig.primaryProvider(): ProviderDto? = providers.firstOrNull()

/**
 * Map a cloud-fetched [SuiteConfig] into the existing [PayCraftConfig] shape.
 * The primary provider is the server-ordered head ([primaryProvider]) — the tenant's per-platform
 * preference — not an arbitrary DB pick. Multi-provider apps consume `SuiteConfig.providers`
 * directly (in the same server order) via the bottom-sheet picker.
 */
internal fun SuiteConfig.toPayCraftConfig(
    backend: PayCraftBackend,
    apiKey: String?,
    nativePricesBySku: Map<String, NativeDisplayPrice> = emptyMap(),
): PayCraftConfig {
    val firstProvider = primaryProvider()
    val provider: PaymentProvider = if (firstProvider != null) {
        SuiteProviderAdapter(firstProvider)
    } else {
        SuiteProviderAdapter.empty()
    }
    return PayCraftConfig(
        supabaseUrl = backend.supabaseUrl,
        supabaseAnonKey = backend.supabaseAnonKey,
        provider = provider,
        plans = products.toBillingPlans(paywall.popularPlanSku, nativePricesBySku),
        benefits = emptyList(), // benefits surface on PaywallDto.themeJsonb in cloud mode
        supportEmail = paywall.supportEmail ?: "support@paycraft.mobilebytesensei.com",
        apiKey = apiKey,
        source = when (backend) {
            is PayCraftBackend.Cloud -> ConfigSource.Cloud
            is PayCraftBackend.SelfHosted -> ConfigSource.SelfHosted
            is PayCraftBackend.Mock -> ConfigSource.Mock
        },
    )
}

private fun List<ProductDto>.toBillingPlans(
    popularSku: String?,
    nativePricesBySku: Map<String, NativeDisplayPrice> = emptyMap(),
): List<BillingPlan> {
    val subscriptions = filter { it.type == "subscription" || it.type == "lifetime" }
        .sortedBy { it.displayOrder }
    val trials = filter { it.type == "trial" }
    return subscriptions.mapIndexed { idx, dto ->
        val attachedTrial = trials.firstOrNull { it.attachesToProductId == dto.id }
        val trialDays = when {
            attachedTrial != null -> attachedTrial.trialDurationDays
            dto.trialEnabled -> dto.trialDurationDays
            else -> null
        }

        // Prefer the NATIVE store price (Play/StoreKit) when one was resolved for this sku — it is
        // the store truth (already reflects the store storefront, e.g. ₹799 from the IN storefront)
        // and its own formatted string is authoritative, overriding the cloud /config price+currency.
        val nativePrice = nativePricesBySku[dto.sku]

        // Resolve the display amounts. resolvedPrice wins (per-locale); fall back to
        // baseCurrency for tenants without a tenant_pricing row.
        val originalCents = dto.resolvedPrice?.amountCents ?: dto.basePriceCents
        val originalCurrency = nativePrice?.currencyCode ?: dto.resolvedPrice?.currency ?: dto.baseCurrency

        // Apply the auto-discount when discount_percent is set AND not expired.
        // Server-side /config already strips expired discounts (see edge function),
        // so by the time we land here a non-null discountPercent means it's active.
        // Discounts apply to the cloud amount only; a native store price is the store's own final
        // charge, so it is shown as-is (the store applies its own promotions).
        val discountPercent = dto.discountPercent?.takeIf { it in 1..99 }
        val effectiveCents = if (discountPercent != null) {
            (originalCents.toLong() * (100 - discountPercent) / 100).toInt()
        } else {
            originalCents
        }

        BillingPlan(
            id = dto.sku,
            name = dto.displayName,
            price = nativePrice?.formatted ?: formatMoney(effectiveCents, originalCurrency),
            originalPrice = if (discountPercent != null && nativePrice == null) {
                formatMoney(originalCents, originalCurrency)
            } else {
                null
            },
            discountPercent = if (nativePrice == null) discountPercent else null,
            discountEndsAt = if (discountPercent != null && nativePrice == null) dto.discountEndsAt else null,
            interval = dto.interval ?: "lifetime",
            rank = idx,
            isPopular = popularSku != null && dto.sku == popularSku,
            trialDays = trialDays,
            currency = originalCurrency.uppercase(),
            // Carry the native store product ids so the Android/iOS billing lanes can transact
            // against them (Google Play Billing / StoreKit2). All current PayCraft products are
            // digital subscriptions/lifetime unlocks → isDigital stays true (default).
            playProductId = dto.playProductId,
            appStoreProductId = dto.appStoreProductId,
        )
    }
}

private fun formatMoney(amountCents: Int, currency: String): String = when (currency.uppercase()) {
    "INR" -> "₹${amountCents / 100}"
    "USD" -> "$${amountCents / 100.0}"
    "EUR" -> "€${amountCents / 100.0}"
    "GBP" -> "£${amountCents / 100.0}"
    else -> "$currency ${amountCents / 100.0}"
}

/**
 * Adapter that turns a cloud-fetched [com.mobilebytelabs.paycraft.config.ProviderDto] into the
 * existing PaymentProvider interface. The payment-link map is picked strictly by
 * [PayCraft.mode] — `pk_test_*` keys read `testPaymentLinksBySku`, `pk_live_*` keys read
 * `livePaymentLinksBySku`. No cross-mode fallback: using a test key with no test link
 * should fail loudly, not silently route through live.
 *
 * The lookup walks `bySku[plan.id]?[plan.currency]` first, then falls back to USD
 * within the same plan so locales without a dedicated link still route somewhere
 * Stripe can render. A missing plan entry throws with a clear remediation hint.
 */
private class SuiteProviderAdapter(private val dto: ProviderDto?) : PaymentProvider {
    override val name: String = dto?.provider ?: "cloud"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val bySku = when (PayCraft.mode) {
            PayCraft.Mode.Test -> dto?.testPaymentLinksBySku ?: emptyMap()
            // Default to live for both Live and Unknown — Unknown can only happen
            // with a Mock backend that has no apiKey, in which case checkout is
            // never reached through the live flow.
            PayCraft.Mode.Live, PayCraft.Mode.Unknown -> dto?.livePaymentLinksBySku ?: emptyMap()
        }
        val perCurrency = bySku[plan.id]
            ?: error(
                "No ${PayCraft.mode.name.lowercase()}-mode checkout URL for plan ${plan.id} — " +
                    "open the PayCraft dashboard, switch to ${PayCraft.mode.name} mode, " +
                    "and add a payment link for this product.",
            )
        // Single deciding point: EVERY provider keys off PayCraft.activeCurrency (the one
        // currency the displayed price uses) with the SAME shared fallback resolved in
        // CurrencyResolver — so two providers can never route different currencies, and the
        // checkout currency can't silently diverge from the price shown on the paywall.
        val currency = CurrencyResolver.checkoutCurrency(PayCraft.activeCurrency, perCurrency.keys)
        val url = perCurrency[currency]
            ?: error(
                "Plan ${plan.id} has no ${PayCraft.mode.name.lowercase()}-mode checkout URL for " +
                    "currency $currency (active=${PayCraft.activeCurrency}) — configure payment " +
                    "links for this product in the PayCraft dashboard.",
            )
        return if (email != null) "$url?prefilled_email=$email" else url
    }

    override fun getManageUrl(email: String): String? = null

    override val webhookFunctionName: String = "${dto?.provider}-webhook"

    companion object {
        fun empty(): SuiteProviderAdapter = SuiteProviderAdapter(null)
    }
}

expect object PayCraftPlatform {
    fun openUrl(url: String)
}
