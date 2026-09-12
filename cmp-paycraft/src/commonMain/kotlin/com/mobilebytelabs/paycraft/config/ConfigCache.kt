package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.russhwolf.settings.Settings
import kotlinx.serialization.json.Json

/**
 * Persists the last-known good [SuiteConfig] to [Settings] for offline-graceful degradation.
 *
 * Storage key defaults to `paycraft.suite_config`. TTL is enforced at read time:
 * if `now - fetchedAt > cacheTtlSeconds`, the cached config is returned with
 * `cacheTtlSeconds = 0` so callers can detect staleness via [isStale].
 */
class ConfigCache(private val settings: Settings, private val key: String = "paycraft.suite_config") {
    // `coerceInputValues` for the same reason as ConfigClient: a cached payload carries the same
    // explicit nulls the server sent, so without it a cache HIT decodes worse than a fresh fetch.
    private val json = Json { ignoreUnknownKeys = true; coerceInputValues = true }

    fun read(): SuiteConfig? = runCatching {
        val raw = settings.getStringOrNull(key) ?: return null
        val cfg = json.decodeFromString(SuiteConfig.serializer(), raw)
        val ageSec = (currentTimeMillis() - cfg.fetchedAtEpochMillis) / 1000
        if (cfg.cacheTtlSeconds > 0 && ageSec > cfg.cacheTtlSeconds) {
            cfg.copy(cacheTtlSeconds = 0)
        } else {
            cfg
        }
    }.getOrNull()

    fun write(cfg: SuiteConfig) {
        settings.putString(key, json.encodeToString(SuiteConfig.serializer(), cfg))
    }

    fun clear() {
        settings.remove(key)
    }

    fun isStale(cfg: SuiteConfig?): Boolean = cfg != null && cfg.cacheTtlSeconds == 0
}
