package com.mobilebytelabs.paycraft.plugin

/**
 * Configuration passed to a [ProviderPlugin] to create a payment provider.
 *
 * Plugins receive this standardized config rather than raw constructor params,
 * so they can be configured uniformly from the CLI, dashboard, or code.
 */
data class PluginConfig(
    /** Payment links: plan_id → checkout URL. */
    val paymentLinks: Map<String, String> = emptyMap(),

    /** Whether to use test/sandbox mode. */
    val isTestMode: Boolean = true,

    /** Provider-specific extra configuration (keys depend on provider). */
    val extras: Map<String, String> = emptyMap(),
) {
    /** Get a required extra config value, throwing if missing. */
    fun requireExtra(key: String): String = extras[key] ?: error("Plugin config missing required key: $key")

    /** Get an optional extra config value. */
    fun getExtra(key: String, default: String? = null): String? = extras[key] ?: default

    companion object {
        /** Builder for fluent config construction. */
        fun builder() = Builder()
    }

    class Builder {
        private val links = mutableMapOf<String, String>()
        private val extras = mutableMapOf<String, String>()
        private var testMode = true

        fun paymentLink(planId: String, url: String) = apply { links[planId] = url }
        fun paymentLinks(links: Map<String, String>) = apply { this.links.putAll(links) }
        fun testMode(enabled: Boolean) = apply { testMode = enabled }
        fun extra(key: String, value: String) = apply { extras[key] = value }

        fun build() = PluginConfig(
            paymentLinks = links.toMap(),
            isTestMode = testMode,
            extras = extras.toMap(),
        )
    }
}
