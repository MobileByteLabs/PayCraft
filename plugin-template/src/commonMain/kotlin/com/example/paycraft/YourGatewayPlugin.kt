package com.example.paycraft

import com.mobilebytelabs.paycraft.plugin.PluginConfig
import com.mobilebytelabs.paycraft.plugin.ProviderPlugin
import com.mobilebytelabs.paycraft.provider.CustomProvider
import com.mobilebytelabs.paycraft.provider.PaymentProvider

/**
 * Example PayCraft provider plugin.
 *
 * Replace "yourgateway" with your actual payment gateway name.
 * Implement the checkout URL builder and any gateway-specific logic.
 */
class YourGatewayPlugin : ProviderPlugin {
    override val id = "yourgateway"
    override val displayName = "YourGateway"
    override val version = "1.0.0"
    override val minSdkVersion = "1.4.0"

    override fun createProvider(config: PluginConfig): PaymentProvider = CustomProvider(
        name = id,
        webhookFunctionName = "$id-webhook",
        checkoutUrlBuilder = { plan, email ->
            val baseUrl = config.paymentLinks[plan.id]
                ?: error("No payment link configured for plan '${plan.id}'")
            if (email != null) "$baseUrl?email=$email" else baseUrl
        },
        manageUrlBuilder = config.getExtra("manage_url")?.let { url ->
            { email: String -> "$url?email=$email" }
        },
    )

    override fun validateConfig(config: PluginConfig): List<String> {
        val errors = mutableListOf<String>()
        if (config.paymentLinks.isEmpty()) {
            errors.add("At least one payment link is required")
        }
        // Add your gateway-specific validation here
        return errors
    }
}
