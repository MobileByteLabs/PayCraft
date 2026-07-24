package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.CouponDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.billing.CheckoutLane
import com.mobilebytelabs.paycraft.billing.resolveCheckoutLane
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.network.CouponClient
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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import org.koin.core.context.GlobalContext

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

    internal val suiteConfig: SuiteConfig? get() = _suiteConfigFlow.value

    internal var backend: PayCraftBackend = PayCraftBackend.Cloud
        private set

    internal var apiKey: String? = null
        private set

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
    private val sdkScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var configFetchJob: Job? = null
    private var initOptions: InitOptions = InitOptions()

    private var _activeCountry: String = CurrencyResolver.DEFAULT_COUNTRY
    private var _activeCurrency: String = CurrencyResolver.FALLBACK_CURRENCY

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
     */
    fun initialize(
        apiKey: String,
        backend: PayCraftBackend = PayCraftBackend.Cloud,
        options: InitOptions = InitOptions(),
    ) {
        require(apiKey.startsWith("pk_test_") || apiKey.startsWith("pk_live_") || backend is PayCraftBackend.Mock) {
            "apiKey must start with pk_test_ or pk_live_"
        }
        this.apiKey = apiKey
        this.backend = backend
        this.initOptions = options
        // Decide the billing country ONCE — the single deciding point that drives the /config
        // locale, the displayed price, and every provider's checkout currency. Override wins,
        // else the device region, else "US". (PlatformInfo reads can throw in odd test
        // harnesses — same guard as the device fingerprint below.)
        this._activeCountry = CurrencyResolver.resolveCountry(
            override = options.localeOverride,
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

            // Kick off the async SuiteConfig fetch from the backend's /config endpoint.
            // ConfigClient handles the cache fallback for offline-graceful degradation.
            configFetchJob?.cancel()
            configFetchJob = sdkScope.launch {
                fetchAndApplySuiteConfig(apiKey, backend, options)
            }
        }
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
        configFetchJob = sdkScope.launch {
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
        val http = HttpClient {
            install(ContentNegotiation) {
                json(
                    Json {
                        ignoreUnknownKeys = true
                        explicitNulls = false
                        isLenient = true
                    },
                )
            }
        }
        try {
            // Re-resolve the country HERE (async fetch time), not the value cached in
            // initialize(). The Android Context that backs SIM-country detection is wired by
            // androidx-startup and — when the host starts Koin via koin-androidx-startup —
            // may not be ready during the synchronous initialize() call (startup ordering
            // race). Reading PlatformInfo.country at fetch time, after app init settles, picks
            // up the real billing region (e.g. an Indian SIM under an en-GB phone language).
            _activeCountry = CurrencyResolver.resolveCountry(
                override = options.localeOverride,
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
            }
            if (!response.status.isSuccess()) {
                PayCraftLogger.onError(
                    "loadConfig",
                    "cloud fetch HTTP ${response.status.value} — paywall stays in loading state",
                )
                return
            }
            val raw: String = response.body()
            val json = Json {
                ignoreUnknownKeys = true
                isLenient = true
            }
            val cfg = json.decodeFromString(SuiteConfig.serializer(), raw)
                .copy(fetchedAtEpochMillis = currentTimeMillis())
            applySuiteConfig(cfg)
            PayCraftLogger.onFlow("loadConfig", "cloud fetch ok — ${cfg.products.size} products")
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            PayCraftLogger.onError("loadConfig", e.message)
        } finally {
            http.close()
        }
    }

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
        val resolved = suite.toPayCraftConfig(backend, apiKey)
        this.config = resolved
        // The cloud resolved prices for the active locale; capture the single currency every
        // provider + the displayed price now share (uniform across products for a locale).
        _activeCurrency = CurrencyResolver.resolveCurrency(resolved.plans)
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
     * Google-Play-compliance routing (Payments policy): on **Android** for a **digital** product the
     * checkout transacts through **Google Play Billing** ([BillingManager.purchaseViaPlayBilling]) —
     * it NEVER opens an external Stripe/Razorpay web payment page (the "leads users to a payment
     * method other than Google Play's billing system" violation). On every other platform
     * (web/desktop/ios/macos) — or a genuinely physical product — it keeps the existing web-link
     * path. The lane is decided by [resolveCheckoutLane], the single unit-tested decision point.
     */
    fun checkout(plan: BillingPlan, email: String? = null) {
        when (val lane = resolveCheckoutLane(PlatformInfo.platform, plan)) {
            is CheckoutLane.Web -> {
                val baseUrl = requireConfig().provider.getCheckoutUrl(plan, email)
                val url = appendCouponParam(baseUrl, appliedCoupons[plan.id]?.code)
                PayCraftPlatform.openUrl(url)
            }
            // Both NativePlay and Misconfigured delegate to the billing manager: it purchases via
            // Play Billing, or (misconfigured play_product_id) sets BillingState.Error WITHOUT ever
            // opening the browser — the anti-steering guarantee.
            is CheckoutLane.NativePlay, is CheckoutLane.Misconfigured ->
                routeAndroidDigitalToPlay(plan, email, lane)
        }
    }

    /**
     * Checkout via a specific provider picked by the user in `ProviderBottomSheet`.
     * Used by the multi-provider flow; single-provider apps use [checkout] instead.
     *
     * Applies the SAME Google-Play-compliance routing as [checkout]: on Android+digital the provider
     * pick is irrelevant — the purchase still goes through Google Play Billing, never the web link.
     */
    internal fun checkoutWithProvider(plan: BillingPlan, provider: ProviderDto, email: String? = null) {
        when (val lane = resolveCheckoutLane(PlatformInfo.platform, plan)) {
            is CheckoutLane.Web -> {
                val adapter = SuiteProviderAdapter(provider)
                val baseUrl = adapter.getCheckoutUrl(plan, email)
                val url = appendCouponParam(baseUrl, appliedCoupons[plan.id]?.code)
                PayCraftPlatform.openUrl(url)
            }
            is CheckoutLane.NativePlay, is CheckoutLane.Misconfigured ->
                routeAndroidDigitalToPlay(plan, email, lane)
        }
    }

    /**
     * Hand an Android digital checkout to Google Play Billing via the Koin-resolved [BillingManager].
     * The manager owns the billing-state flow the paywall observes (Loading → Success/Cancelled/Error)
     * and enforces the anti-steering guard (blank play product id → error, never a browser fallback).
     */
    private fun routeAndroidDigitalToPlay(plan: BillingPlan, email: String?, lane: CheckoutLane) {
        val billingManager = GlobalContext.getOrNull()?.getOrNull<BillingManager>()
        if (billingManager == null) {
            // No Koin graph (should never happen in a real app — the paywall itself is Koin-resolved).
            // Fail CLOSED: log and stop. We deliberately do NOT open the browser here — that would be
            // the exact anti-steering violation we are preventing.
            PayCraftLogger.onError(
                "checkout",
                "Android digital checkout for ${plan.id} but no BillingManager in the Koin graph — " +
                    "load PayCraftModule + paycraftPlayBillingModule. Refusing web fallback (anti-steering).",
            )
            return
        }
        if (lane is CheckoutLane.Misconfigured) {
            PayCraftLogger.onError("checkout", "${lane.reason} for plan ${plan.id} (Android digital)")
        }
        billingManager.purchaseViaPlayBilling(plan, email)
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
 * Map a cloud-fetched [SuiteConfig] into the existing [PayCraftConfig] shape.
 * Provider construction is best-effort — the first registered provider wins for the
 * legacy single-provider field. Multi-provider apps consume `SuiteConfig.providers`
 * directly via the bottom-sheet picker.
 */
internal fun SuiteConfig.toPayCraftConfig(backend: PayCraftBackend, apiKey: String?): PayCraftConfig {
    val firstProvider = providers.firstOrNull()
    val provider: PaymentProvider = if (firstProvider != null) {
        SuiteProviderAdapter(firstProvider)
    } else {
        SuiteProviderAdapter.empty()
    }
    return PayCraftConfig(
        supabaseUrl = backend.supabaseUrl,
        supabaseAnonKey = backend.supabaseAnonKey,
        provider = provider,
        plans = products.toBillingPlans(paywall.popularPlanSku),
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

private fun List<ProductDto>.toBillingPlans(popularSku: String?): List<BillingPlan> {
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

        // Resolve the display amounts. resolvedPrice wins (per-locale); fall back to
        // baseCurrency for tenants without a tenant_pricing row.
        val originalCents = dto.resolvedPrice?.amountCents ?: dto.basePriceCents
        val originalCurrency = dto.resolvedPrice?.currency ?: dto.baseCurrency

        // Apply the auto-discount when discount_percent is set AND not expired.
        // Server-side /config already strips expired discounts (see edge function),
        // so by the time we land here a non-null discountPercent means it's active.
        val discountPercent = dto.discountPercent?.takeIf { it in 1..99 }
        val effectiveCents = if (discountPercent != null) {
            (originalCents.toLong() * (100 - discountPercent) / 100).toInt()
        } else {
            originalCents
        }

        BillingPlan(
            id = dto.sku,
            name = dto.displayName,
            price = formatMoney(effectiveCents, originalCurrency),
            originalPrice = if (discountPercent != null) {
                formatMoney(originalCents, originalCurrency)
            } else {
                null
            },
            discountPercent = discountPercent,
            discountEndsAt = if (discountPercent != null) dto.discountEndsAt else null,
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
