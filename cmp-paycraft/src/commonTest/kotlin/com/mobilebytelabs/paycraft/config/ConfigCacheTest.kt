package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Contract tests for [ConfigCache] — the offline-graceful persistence layer for [SuiteConfig].
 *
 * Backed by an in-memory [MapSettings] so the suite runs on every KMP target without
 * touching a real `NSUserDefaults` / `SharedPreferences` / `Properties` file. TTL behavior
 * is exercised by backdating `fetchedAtEpochMillis` relative to `currentTimeMillis()`.
 */
class ConfigCacheTest {

    private val storageKey = "paycraft.suite_config"

    private fun makeCache(seed: Map<String, Any> = emptyMap()): Pair<ConfigCache, MapSettings> {
        val settings = MapSettings(seed.toMutableMap())
        return ConfigCache(settings, key = storageKey) to settings
    }

    private fun sampleConfig(
        fetchedAtEpochMillis: Long = currentTimeMillis(),
        cacheTtlSeconds: Int = 3600,
    ): SuiteConfig = SuiteConfig(
        tenantId = "tenant-cache",
        products = listOf(
            ProductDto(
                id = "p1",
                sku = "monthly",
                type = "subscription",
                displayName = "Monthly",
                interval = "month",
                basePriceCents = 999,
                baseCurrency = "USD",
            ),
        ),
        providers = listOf(
            ProviderDto(
                provider = "stripe",
                testPaymentLinks = mapOf("monthly" to "https://test.link/monthly"),
            ),
        ),
        paywall = PaywallDto(supportEmail = "support@example.com"),
        cacheTtlSeconds = cacheTtlSeconds,
        fetchedAtEpochMillis = fetchedAtEpochMillis,
    )

    @Test
    fun write_persists_SuiteConfig_to_settings_under_canonical_key() {
        val (cache, settings) = makeCache()

        cache.write(sampleConfig())

        // The raw JSON string is now sitting under the canonical storage key —
        // proves the writer is using the key we passed (no rogue prefixes).
        val raw = settings.getStringOrNull(storageKey)
        assertNotNull(raw, "write() should persist a JSON payload under '$storageKey'")
        assertTrue(raw.contains("\"tenant_id\":\"tenant-cache\""))
    }

    @Test
    fun read_returns_null_when_no_cached_value() {
        val (cache, _) = makeCache()
        assertNull(cache.read(), "read() on a fresh cache must be null")
    }

    @Test
    fun read_returns_the_persisted_SuiteConfig() {
        val (cache, _) = makeCache()
        val original = sampleConfig()

        cache.write(original)
        val loaded = cache.read()

        assertNotNull(loaded)
        assertEquals(original.tenantId, loaded.tenantId)
        assertEquals(original.products.first().sku, loaded.products.first().sku)
        assertEquals(original.providers.first().provider, loaded.providers.first().provider)
        assertEquals(original.paywall.supportEmail, loaded.paywall.supportEmail)
        // TTL preserved (still well within the 1h window)
        assertEquals(original.cacheTtlSeconds, loaded.cacheTtlSeconds)
    }

    @Test
    fun isStale_returns_false_within_TTL_window() {
        val (cache, _) = makeCache()
        // Fetched 60 seconds ago, TTL is 1h → fresh.
        val cfg = sampleConfig(
            fetchedAtEpochMillis = currentTimeMillis() - 60_000L,
            cacheTtlSeconds = 3600,
        )
        cache.write(cfg)

        val loaded = cache.read()
        assertNotNull(loaded)
        assertFalse(cache.isStale(loaded), "Config 60s old with TTL=3600 must not be stale")
    }

    @Test
    fun isStale_returns_true_after_TTL_expires() {
        val (cache, _) = makeCache()
        // Fetched 2 hours ago, TTL is 1h → expired. Reader downgrades cacheTtlSeconds to 0.
        val cfg = sampleConfig(
            fetchedAtEpochMillis = currentTimeMillis() - (2 * 60 * 60 * 1000L),
            cacheTtlSeconds = 3600,
        )
        cache.write(cfg)

        val loaded = cache.read()
        assertNotNull(loaded, "Expired config is still returned (callers decide what to do)")
        assertEquals(0, loaded.cacheTtlSeconds, "TTL must be downgraded to 0 on expiry")
        assertTrue(cache.isStale(loaded), "isStale() must trip once TTL is downgraded")
    }

    @Test
    fun isStale_returns_true_when_cacheTtlSeconds_is_zero() {
        val cache = ConfigCache(MapSettings(), key = storageKey)
        // A SuiteConfig that the SDK has already marked stale.
        val cfg = sampleConfig(cacheTtlSeconds = 0)

        assertTrue(cache.isStale(cfg))
    }

    @Test
    fun isStale_returns_false_for_null_config() {
        val cache = ConfigCache(MapSettings(), key = storageKey)
        assertFalse(cache.isStale(null), "null is not stale — it's just absent")
    }

    @Test
    fun clear_removes_the_cached_value() {
        val (cache, settings) = makeCache()
        cache.write(sampleConfig())
        assertNotNull(settings.getStringOrNull(storageKey))

        cache.clear()

        assertNull(settings.getStringOrNull(storageKey), "clear() must remove the entry from Settings")
        assertNull(cache.read(), "read() after clear() must be null")
    }
}
