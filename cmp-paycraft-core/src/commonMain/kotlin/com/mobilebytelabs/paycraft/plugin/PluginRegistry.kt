package com.mobilebytelabs.paycraft.plugin

/**
 * Registry for discovered provider plugins.
 *
 * On JVM, plugins are discovered via ServiceLoader (META-INF/services).
 * On other platforms, plugins must be registered manually.
 *
 * ```kotlin
 * // Manual registration (all platforms)
 * PluginRegistry.register(MyGatewayPlugin())
 *
 * // List all registered plugins
 * PluginRegistry.all().forEach { println(it.displayName) }
 *
 * // Get a specific plugin
 * val plugin = PluginRegistry.get("mygateway")
 * ```
 */
object PluginRegistry {
    private val plugins = mutableMapOf<String, ProviderPlugin>()

    /** Register a plugin. Replaces any existing plugin with the same id. */
    fun register(plugin: ProviderPlugin) {
        val errors = validatePlugin(plugin)
        if (errors.isNotEmpty()) {
            error("Invalid plugin '${plugin.id}': ${errors.joinToString(", ")}")
        }
        plugins[plugin.id] = plugin
    }

    /** Unregister a plugin by id. */
    fun unregister(id: String) {
        plugins.remove(id)
    }

    /** Get a registered plugin by id, or null. */
    fun get(id: String): ProviderPlugin? = plugins[id]

    /** Get all registered plugins. */
    fun all(): List<ProviderPlugin> = plugins.values.toList()

    /** Check if a plugin is registered. */
    fun has(id: String): Boolean = plugins.containsKey(id)

    /** Clear all registered plugins. Mainly for testing. */
    fun clear() {
        plugins.clear()
    }

    private fun validatePlugin(plugin: ProviderPlugin): List<String> {
        val errors = mutableListOf<String>()
        if (plugin.id.isBlank()) errors.add("id must not be blank")
        if (plugin.id.contains(" ")) errors.add("id must not contain spaces")
        if (plugin.displayName.isBlank()) errors.add("displayName must not be blank")
        if (plugin.version.isBlank()) errors.add("version must not be blank")
        return errors
    }
}
