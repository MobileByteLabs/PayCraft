package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.CouponDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.network.CouponClient
import com.mobilebytelabs.paycraft.provider.PaymentProvider
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.statement.HttpResponse
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

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

    internal var suiteConfig: SuiteConfig? = null
        private set

    internal var backend: PayCraftBackend = PayCraftBackend.Cloud
        private set

    internal var apiKey: String? = null
        private set

    /** Long-lived scope for the SDK's background work — currently just the cloud SuiteConfig fetch. */
    private val sdkScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var configFetchJob: Job? = null

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
        PayCraftLogger.onInitialize(
            backendName = when (backend) {
                is PayCraftBackend.Cloud -> "cloud"
                is PayCraftBackend.SelfHosted -> "self-hosted:${backend.supabaseUrl}"
                is PayCraftBackend.Mock -> "mock"
            },
            apiKeyPrefix = apiKey.substringBefore('_', "?") + "_…",
            debug = options.debug,
        )
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
     * Hit `backend.configUrl` for the SuiteConfig, decode, and publish via
     * [applySuiteConfig]. Inline HTTP fetch — bypasses [com.mobilebytelabs.paycraft.config.ConfigClient]
     * to avoid the [com.russhwolf.settings.Settings] dependency that needs a
     * platform-injected Context on Android. Persistent cache is a TODO once we
     * accept a Settings via initialize() options.
     */
    private suspend fun fetchAndApplySuiteConfig(
        apiKey: String,
        backend: PayCraftBackend,
        options: InitOptions,
    ) {
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
            val locale = options.localeOverride ?: "US"
            PayCraftLogger.onFlow("loadConfig", "GET ${backend.configUrl}?apiKey=${apiKey.take(8)}…")
            // Supabase Edge Functions require an Authorization header by default
            // (verify_jwt=true at the platform level). Pass the backend's known
            // anon key — same value the SDK uses for the postgrest data plane.
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
        this.suiteConfig = suite
        val resolved = suite.toPayCraftConfig(backend, apiKey)
        this.config = resolved
        PayCraftLogger.onSuiteConfigApplied(
            source = resolved.source.name,
            productCount = suite.products.size,
            providerCount = suite.providers.size,
            primaryProvider = suite.providers.firstOrNull()?.provider ?: "none",
            locale = suite.locale,
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

    fun checkout(plan: BillingPlan, email: String? = null) {
        val baseUrl = requireConfig().provider.getCheckoutUrl(plan, email)
        val url = appendCouponParam(baseUrl, appliedCoupons[plan.id]?.code)
        PayCraftPlatform.openUrl(url)
    }

    /**
     * Checkout via a specific provider picked by the user in `ProviderBottomSheet`.
     * Used by the multi-provider flow; single-provider apps use [checkout] instead.
     */
    internal fun checkoutWithProvider(plan: BillingPlan, provider: ProviderDto, email: String? = null) {
        val adapter = SuiteProviderAdapter(provider)
        val baseUrl = adapter.getCheckoutUrl(plan, email)
        val url = appendCouponParam(baseUrl, appliedCoupons[plan.id]?.code)
        PayCraftPlatform.openUrl(url)
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
        plans = products.toBillingPlans(),
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

private fun List<ProductDto>.toBillingPlans(): List<BillingPlan> {
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
            isPopular = false,
            trialDays = trialDays,
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
 * existing PaymentProvider interface. Locale-resolved checkout URL is taken from livePaymentLinks
 * first, then testPaymentLinks.
 */
private class SuiteProviderAdapter(private val dto: ProviderDto?) : PaymentProvider {
    override val name: String = dto?.provider ?: "cloud"

    override fun getCheckoutUrl(plan: BillingPlan, email: String?): String {
        val map = dto?.livePaymentLinks?.takeIf { it.isNotEmpty() } ?: dto?.testPaymentLinks ?: emptyMap()
        val url = map[plan.id] ?: error("No checkout URL for plan ${plan.id}")
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
