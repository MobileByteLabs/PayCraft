package com.mobilebytelabs.paycraft.config

import com.russhwolf.settings.MapSettings
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * RT-2 — the persistent config cache, which shipped unwired.
 *
 * `ConfigCache` existed and was correct; nothing read or wrote it. The inline fetch in `PayCraft`
 * carried a "persistent cache is a TODO" note and decoded straight into memory, so the SDK's
 * offline story held only within a single process: every first open of the day rendered the
 * skeleton, and a launch with no connectivity rendered no products at all — while a comment in
 * `initialize()` claimed the opposite.
 *
 * These pin the behaviour the wiring now depends on: a config survives process death, a stale one
 * is still served (degraded, flagged) rather than dropped, and a corrupt entry never crashes a
 * launch.
 */
class ConfigCachePersistenceTest {

    private fun suite(
        tenantId: String = "tenant-1",
        products: List<ProductDto> = listOf(
            ProductDto(id = "p1", sku = "premium_monthly", type = "subscription", displayName = "Monthly"),
        ),
        fetchedAt: Long = 1_700_000_000_000L,
        ttlSeconds: Int = 3600,
    ) = SuiteConfig(
        tenantId = tenantId,
        products = products,
        fetchedAtEpochMillis = fetchedAt,
        cacheTtlSeconds = ttlSeconds,
    )

    @Test
    fun writtenConfigSurvivesANewCacheInstance() {
        // MapSettings stands in for the on-disk store; a second ConfigCache over the same backing
        // map is the closest device-free analogue of a fresh process reading what the last one left.
        val settings = MapSettings()
        ConfigCache(settings).write(suite())

        val read = ConfigCache(settings).read()

        assertNotNull(read, "A written config must be readable by the next process — that IS the fix.")
        assertEquals("tenant-1", read.tenantId)
        assertEquals(1, read.products.size)
        assertEquals("premium_monthly", read.products.first().sku)
    }

    @Test
    fun emptyCacheReadsNullRatherThanThrowing() {
        assertNull(
            ConfigCache(MapSettings()).read(),
            "A genuinely cold start must read null, not fail — it is the common first-launch path.",
        )
    }

    @Test
    fun corruptEntryReadsNullRatherThanCrashingTheLaunch() {
        val settings = MapSettings()
        settings.putString("paycraft.suite_config", "{ not json at all ")

        assertNull(
            ConfigCache(settings).read(),
            "A corrupt cache entry must degrade to a cold start. This read happens synchronously " +
                "during initialize(), so a throw here would take down app launch.",
        )
    }

    @Test
    fun expiredConfigIsStillServedButFlaggedStale() {
        val settings = MapSettings()
        // Fetched at epoch 0 with a 1-second TTL — unambiguously expired against any real clock.
        ConfigCache(settings).write(suite(fetchedAt = 0L, ttlSeconds = 1))

        val cache = ConfigCache(settings)
        val read = cache.read()

        assertNotNull(read, "A stale config still beats an empty paywall — serve it, then revalidate.")
        assertTrue(cache.isStale(read), "…but it must be flagged stale so callers know to refresh.")
    }

    @Test
    fun clearRemovesThePersistedConfig() {
        val settings = MapSettings()
        val cache = ConfigCache(settings)
        cache.write(suite())

        cache.clear()

        assertNull(cache.read(), "clear() must leave nothing behind — it backs logout/reset.")
    }

    @Test
    fun writeOverwritesThePreviousConfig() {
        val settings = MapSettings()
        val cache = ConfigCache(settings)
        cache.write(suite(tenantId = "old"))

        cache.write(suite(tenantId = "new"))

        assertEquals(
            "new",
            cache.read()?.tenantId,
            "Each successful fetch replaces the cache — a stale tenant must never linger.",
        )
    }
}
