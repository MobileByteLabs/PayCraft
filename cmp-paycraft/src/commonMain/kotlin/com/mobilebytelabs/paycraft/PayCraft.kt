package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.model.BillingBenefit
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.provider.PaymentProvider
import com.mobilebytelabs.paycraft.provider.StripeProvider

object PayCraft {

    internal var config: PayCraftConfig? = null
        private set

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

    fun requireConfig(): PayCraftConfig = config ?: error("PayCraft.configure() must be called before use")

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

data class PayCraftConfig(
    val supabaseUrl: String,
    val supabaseAnonKey: String,
    val provider: PaymentProvider,
    val plans: List<BillingPlan>,
    val benefits: List<BillingBenefit>,
    val supportEmail: String,
    // PayCraft Cloud API key (pk_test_ or pk_live_). Null = self-hosted single-tenant.
    val apiKey: String? = null,
)

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

    /** Set PayCraft Cloud API key for multi-tenant mode. Omit for self-hosted. */
    fun cloud(apiKey: String) {
        this.apiKey = apiKey
    }

    fun provider(provider: PaymentProvider) {
        this.provider = provider
    }

    fun plans(vararg plans: BillingPlan) {
        this.plans = plans.toList()
    }

    fun plans(plans: List<BillingPlan>) {
        this.plans = plans
    }

    fun benefits(vararg benefits: BillingBenefit) {
        this.benefits = benefits.toList()
    }

    fun benefits(benefits: List<BillingBenefit>) {
        this.benefits = benefits
    }

    fun supportEmail(email: String) {
        this.supportEmail = email
    }

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
        )
    }
}

expect object PayCraftPlatform {
    fun openUrl(url: String)
}
