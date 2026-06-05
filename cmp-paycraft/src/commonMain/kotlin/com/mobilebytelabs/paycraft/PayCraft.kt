package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.provider.PaymentProvider
import com.mobilebytelabs.paycraft.provider.StripeProvider

/**
 * PayCraft — the single entry point.
 *
 * Two integration paths, both fully supported:
 *
 * **Cloud (recommended)** — products + providers + paywall configured at paycraft.cloud
 *
 * ```kotlin
 * PayCraft.initialize(apiKey = "pk_live_…")
 * ```
 *
 * **In-code** — declare everything in the app (single-tenant deployments)
 *
 * ```kotlin
 * PayCraft.configure {
 *   supabase(url = "…", anonKey = "…")
 *   provider(StripeProvider(…))
 *   plans(BillingPlan(…))
 *   benefits(BillingBenefit(…))
 *   supportEmail("…")
 * }
 * ```
 *
 * Both produce a [PayCraftConfig] consumed by the rest of the SDK.
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
     * Cloud / Self-host / Mock initialization.
     * Stores [apiKey] + [backend] so the lazy [SuiteConfig] fetcher can run on first
     * paywall render. Apps may call [refreshConfig] to force-fetch immediately.
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
        // For Mock backend, build PayCraftConfig immediately from static SuiteConfig.
        if (backend is PayCraftBackend.Mock) {
            applySuiteConfig(backend.staticConfig)
        }
    }

    /**
     * Programmatic in-code configuration. Use this for self-host deployments where
     * products, providers, and paywall live in the app, not the cloud.
     */
    fun configure(builder: PayCraftConfigBuilder.() -> Unit) {
        val cfg = PayCraftConfigBuilder().apply(builder).build()
        config = cfg
        val stripe = cfg.provider as? StripeProvider
        PayCraftLogger.onConfigure(
            provider = cfg.provider.name,
            modeLabel = stripe?.modeLabel ?: cfg.provider.name,
            planCount = cfg.plans.size,
            planIds = cfg.plans.joinToString { "${it.id}${if (it.isPopular) "*" else ""}" },
            testLinks = stripe?.testLinkCount ?: -1,
            liveLinks = stripe?.liveLinkCount ?: -1,
            supabaseUrl = cfg.supabaseUrl,
        )
    }

    /** Apply a cloud-fetched [SuiteConfig] into the existing PayCraftConfig shape. */
    internal fun applySuiteConfig(suite: SuiteConfig) {
        this.suiteConfig = suite
        this.config = suite.toPayCraftConfig(backend, apiKey)
    }

    fun requireConfig(): PayCraftConfig =
        config ?: error("PayCraft.initialize(apiKey) or PayCraft.configure { } must be called before use")

    fun checkout(plan: BillingPlan, email: String? = null) {
        val url = requireConfig().provider.getCheckoutUrl(plan, email)
        PayCraftPlatform.openUrl(url)
    }

    fun manageSubscription(email: String) {
        val url = requireConfig().provider.getManageUrl(email)
        val stripe = requireConfig().provider as? StripeProvider
        PayCraftLogger.onManageSubscription(mode = stripe?.modeLabel ?: "unknown", url = url)
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
    val source: ConfigSource = ConfigSource.InCode,
)

enum class ConfigSource { Cloud, SelfHosted, InCode, Mock }

class PayCraftConfigBuilder {
    private var supabaseUrl: String = ""
    private var supabaseAnonKey: String = ""
    private var provider: PaymentProvider? = null
    private var plans: List<BillingPlan> = emptyList()
    private var benefits: List<BillingBenefit> = emptyList()
    private var supportEmail: String = ""
    private var apiKey: String? = null

    fun supabase(url: String, anonKey: String) {
        this.supabaseUrl = url
        this.supabaseAnonKey = anonKey
    }

    /** Set PayCraft Cloud API key alongside in-code config (hybrid mode). */
    fun cloud(apiKey: String) {
        this.apiKey = apiKey
    }

    fun provider(provider: PaymentProvider) {
        this.provider = provider
    }

    fun plans(vararg plans: BillingPlan) { this.plans = plans.toList() }
    fun plans(plans: List<BillingPlan>)   { this.plans = plans }

    fun benefits(vararg benefits: BillingBenefit) { this.benefits = benefits.toList() }
    fun benefits(benefits: List<BillingBenefit>)   { this.benefits = benefits }

    fun supportEmail(email: String) { this.supportEmail = email }

    internal fun build(): PayCraftConfig {
        require(supabaseUrl.isNotBlank()) { "supabase(url, anonKey) must be configured" }
        require(supabaseAnonKey.isNotBlank()) { "supabase(url, anonKey) must be configured" }
        requireNotNull(provider) { "provider() must be configured" }
        require(plans.isNotEmpty()) { "plans() must have at least one plan" }
        return PayCraftConfig(
            supabaseUrl = supabaseUrl,
            supabaseAnonKey = supabaseAnonKey,
            provider = provider!!,
            plans = plans.sortedBy { it.rank },
            benefits = benefits,
            supportEmail = supportEmail,
            apiKey = apiKey,
            source = ConfigSource.InCode,
        )
    }
}

/**
 * Map a cloud-fetched [SuiteConfig] into the existing [PayCraftConfig] shape.
 * Provider construction is best-effort — the canonical "first provider" wins for the
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
    // For each subscription, attach trial_days if a trial dto references it.
    return subscriptions.mapIndexed { idx, dto ->
        val trialDays = trials.firstOrNull { it.attachesToProductId == dto.id }?.trialDurationDays
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

/** Adapter that turns a cloud-fetched [com.mobilebytelabs.paycraft.config.ProviderDto] into the
 *  existing PaymentProvider interface. Locale-resolved checkout URL is taken from livePaymentLinks
 *  first, then testPaymentLinks. */
private class SuiteProviderAdapter(
    private val dto: com.mobilebytelabs.paycraft.config.ProviderDto?,
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
