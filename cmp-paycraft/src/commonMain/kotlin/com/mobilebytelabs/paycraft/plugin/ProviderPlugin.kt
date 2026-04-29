package com.mobilebytelabs.paycraft.plugin

import com.mobilebytelabs.paycraft.provider.PaymentProvider

/**
 * Plugin interface for community-contributed payment providers.
 *
 * To create a PayCraft provider plugin:
 * 1. Create a new KMP library module
 * 2. Implement [ProviderPlugin] — it acts as a factory for your [PaymentProvider]
 * 3. Register via META-INF/services (JVM) or the plugin registry
 * 4. Publish to Maven Central as a separate artifact
 *
 * Example:
 * ```kotlin
 * class MyGatewayPlugin : ProviderPlugin {
 *     override val id = "mygateway"
 *     override val displayName = "MyGateway"
 *     override val version = "1.0.0"
 *
 *     override fun createProvider(config: PluginConfig): PaymentProvider {
 *         return CustomProvider(
 *             name = "mygateway",
 *             webhookFunctionName = "mygateway-webhook",
 *             checkoutUrlBuilder = { plan, email ->
 *                 config.paymentLinks[plan.id] ?: error("No link for ${plan.id}")
 *             },
 *         )
 *     }
 * }
 * ```
 *
 * Users install with:
 * ```kotlin
 * implementation("com.example:paycraft-mygateway:1.0.0")
 *
 * PayCraft.configure {
 *     provider(MyGatewayPlugin().createProvider(config))
 * }
 * ```
 */
interface ProviderPlugin {
    /** Unique plugin identifier (lowercase, no spaces). */
    val id: String

    /** Human-readable name. */
    val displayName: String

    /** Plugin version (semver). */
    val version: String

    /** Minimum PayCraft SDK version this plugin is compatible with. */
    val minSdkVersion: String
        get() = "1.4.0"

    /** Create the payment provider from the given configuration. */
    fun createProvider(config: PluginConfig): PaymentProvider

    /** Validate that the config is complete before creating the provider. */
    fun validateConfig(config: PluginConfig): List<String> {
        val errors = mutableListOf<String>()
        if (config.paymentLinks.isEmpty()) {
            errors.add("At least one payment link is required")
        }
        return errors
    }
}
