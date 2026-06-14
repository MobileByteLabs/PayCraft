package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.provider.PaymentProvider

/**
 * PayCraft — the single SDK entry point.
 *
 * ```kotlin
 * PayCraft.initialize(apiKey = "pk_live_…")
 * ```
 *
 * All products, providers, pricing, and paywall styling are fetched from your PayCraft
 * dashboard (https://paycraft.cloud) and refreshed on a tiered cache policy. The SDK
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
        }
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

    fun requireConfig(): PayCraftConfig =
        config ?: error("PayCraft.initialize(apiKey) must be called before use")

    fun checkout(plan: BillingPlan, email: String? = null) {
        val url = requireConfig().provider.getCheckoutUrl(plan, email)
        PayCraftPlatform.openUrl(url)
    }

    /**
     * Checkout via a specific provider picked by the user in `ProviderBottomSheet`.
     * Used by the multi-provider flow; single-provider apps use [checkout] instead.
     */
    internal fun checkoutWithProvider(plan: BillingPlan, provider: ProviderDto, email: String? = null) {
        val adapter = SuiteProviderAdapter(provider)
        val url = adapter.getCheckoutUrl(plan, email)
        PayCraftPlatform.openUrl(url)
    }

    fun manageSubscription(email: String) {
        val url = requireConfig().provider.getManageUrl(email)
        PayCraftLogger.onManageSubscription(mode = "cloud", url = url)
        if (url != null) PayCraftPlatform.openUrl(url)
    }
}

data class InitOptions(
    val localeOverride: String? = null,   // ISO 3166-1 alpha-2; null = system locale
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
internal fun SuiteConfig.toPayCraftConfig(
    backend: PayCraftBackend,
    apiKey: String?,
): PayCraftConfig {
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
        supportEmail = paywall.supportEmail ?: "support@paycraft.cloud",
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
        BillingPlan(
            id = dto.sku,
            name = dto.displayName,
            price = dto.resolvedPrice?.let { p -> formatMoney(p.amountCents, p.currency) }
                ?: formatMoney(dto.basePriceCents, dto.baseCurrency),
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
private class SuiteProviderAdapter(
    private val dto: ProviderDto?,
) : PaymentProvider {
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
