package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.russhwolf.settings.MapSettings
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Contract tests for [ConfigClient] — HTTP fetch + cache fallback for [SuiteConfig].
 *
 * The Cloud / SelfHosted code path goes through Ktor. We pin Ktor to a
 * [MockEngine] so we can:
 *   - assert that requests carry `apiKey` and `Accept-Language` correctly
 *   - simulate 5xx and IOException without a network round-trip
 *
 * Cache fallback is observed by writing a sentinel [SuiteConfig] to a real
 * [ConfigCache] backed by [MapSettings], then forcing the HTTP path to fail.
 */
class ConfigClientTest {

    private val configJson = """
        {
          "tenant_id": "tenant-fetch",
          "products": [
            {
              "id": "p1",
              "sku": "monthly",
              "type": "subscription",
              "display_name": "Monthly",
              "interval": "month",
              "base_price_cents": 999,
              "base_currency": "USD"
            }
          ],
          "providers": [
            {
              "provider": "stripe",
              "test_payment_links": { "monthly": { "USD": "https://test.link/monthly" } }
            }
          ],
          "paywall": { "template": "minimal" },
          "cache_ttl_seconds": 3600
        }
    """.trimIndent()

    private fun selfHosted(): PayCraftBackend.SelfHosted = PayCraftBackend.SelfHosted(
        supabaseUrl = "https://example.supabase.test",
        supabaseAnonKey = "anon-test-key",
    )

    /**
     * Tiny scope wrapper so test bodies can call `respondOk(...)` / `respondStatus(...)` /
     * `respondThrow(...)` without leaking the full Ktor MockEngine surface. Each helper
     * captures the produced response into [lastResponse] so the outer engine handler can
     * return it after the test's lambda runs.
     */
    private class MockRequestHandlerScopeImpl(
        private val ktorScope: io.ktor.client.engine.mock.MockRequestHandleScope,
    ) {
        var lastResponse: io.ktor.client.request.HttpResponseData? = null
            private set

        fun respondOk(body: String) {
            lastResponse = ktorScope.respond(
                content = ByteReadChannel(body),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }

        fun respondStatus(status: HttpStatusCode) {
            lastResponse = ktorScope.respondError(status)
        }

        fun respondThrow(error: Throwable): Nothing = throw error
    }

    /** Build a Ktor client whose engine routes every request through [handler]. */
    private fun httpClient(
        recorder: MutableList<HttpRequestData>? = null,
        handler: MockRequestHandlerScopeImpl.(HttpRequestData) -> Unit,
    ): HttpClient = HttpClient(MockEngine) {
        engine {
            addHandler { request ->
                recorder?.add(request)
                val scope = MockRequestHandlerScopeImpl(this)
                scope.handler(request)
                scope.lastResponse ?: respond("", HttpStatusCode.OK)
            }
        }
    }

    private fun freshCache(): ConfigCache = ConfigCache(MapSettings())

    // ────────── happy path ──────────

    @Test
    fun fetch_returns_SuiteConfig_on_200_OK_with_valid_JSON() = runTest {
        val http = httpClient { respondOk(configJson) }
        val client = ConfigClient(http, selfHosted(), apiKey = "pk_test_123", cache = freshCache())

        val cfg = client.fetch()

        assertNotNull(cfg)
        assertEquals("tenant-fetch", cfg.tenantId)
        assertEquals(1, cfg.products.size)
        assertEquals("monthly", cfg.products.first().sku)
        // ConfigClient stamps the receive time — must be non-zero post-fetch.
        assertTrue(cfg.fetchedAtEpochMillis > 0, "fetchedAtEpochMillis should be stamped on receive")
    }

    @Test
    fun fetch_includes_apiKey_as_query_parameter() = runTest {
        val captured = mutableListOf<HttpRequestData>()
        val http = httpClient(recorder = captured) { respondOk(configJson) }
        val client = ConfigClient(http, selfHosted(), apiKey = "pk_live_secret", cache = freshCache())

        client.fetch()

        assertEquals(1, captured.size, "exactly one HTTP request expected")
        val url = captured.first().url.toString()
        assertTrue(
            url.contains("apiKey=pk_live_secret"),
            "request URL must carry apiKey query param; got: $url",
        )
    }

    @Test
    fun fetch_sends_Accept_Language_header_derived_from_localeCountry() = runTest {
        val captured = mutableListOf<HttpRequestData>()
        val http = httpClient(recorder = captured) { respondOk(configJson) }
        val client = ConfigClient(http, selfHosted(), apiKey = "pk_test_x", cache = freshCache())

        client.fetch(localeCountry = "IN")

        val header = captured.first().headers[HttpHeaders.AcceptLanguage]
        assertEquals("en-IN", header, "Accept-Language must be en-{localeCountry}")
    }

    @Test
    fun fetch_writes_result_to_cache_on_success() = runTest {
        val cache = freshCache()
        val http = httpClient { respondOk(configJson) }
        val client = ConfigClient(http, selfHosted(), apiKey = "pk_test_w", cache = cache)

        // Pre-condition: empty cache.
        assertNull(cache.read())

        val cfg = client.fetch()

        assertNotNull(cfg)
        val cached = cache.read()
        assertNotNull(cached, "fetch() success must persist to ConfigCache")
        assertEquals(cfg.tenantId, cached.tenantId)
    }

    // ────────── fallback path ──────────

    @Test
    fun fetch_returns_cached_SuiteConfig_when_HTTP_returns_5xx() = runTest {
        val cache = freshCache()
        // Pre-seed the cache with a sentinel value.
        val sentinel = SuiteConfig(
            tenantId = "from-cache",
            cacheTtlSeconds = 3600,
            fetchedAtEpochMillis = 1_000L,
        )
        cache.write(sentinel)

        val http = httpClient { respondStatus(HttpStatusCode.InternalServerError) }
        val client = ConfigClient(http, selfHosted(), apiKey = "pk_test_e", cache = cache)

        val cfg = client.fetch()

        assertNotNull(cfg, "5xx must fall back to cache, not return null")
        assertEquals("from-cache", cfg.tenantId)
    }

    @Test
    fun fetch_returns_cached_SuiteConfig_when_network_throws() = runTest {
        val cache = freshCache()
        val sentinel = SuiteConfig(
            tenantId = "offline-cached",
            cacheTtlSeconds = 3600,
            fetchedAtEpochMillis = 1_000L,
        )
        cache.write(sentinel)

        val http = httpClient { respondThrow(RuntimeException("simulated offline")) }
        val client = ConfigClient(http, selfHosted(), apiKey = "pk_test_o", cache = cache)

        val cfg = client.fetch()

        assertNotNull(cfg, "Network IO failure must fall back to cache")
        assertEquals("offline-cached", cfg.tenantId)
    }

    @Test
    fun fetch_returns_null_when_HTTP_fails_and_cache_is_empty() = runTest {
        val http = httpClient { respondStatus(HttpStatusCode.BadGateway) }
        val client = ConfigClient(http, selfHosted(), apiKey = "pk_test_n", cache = freshCache())

        assertNull(client.fetch(), "no cache + HTTP fail → null (callers degrade gracefully)")
    }

    @Test
    fun fetch_bypasses_HTTP_entirely_for_Mock_backend() = runTest {
        val staticCfg = SuiteConfig(tenantId = "mock-tenant", cacheTtlSeconds = 0)
        val mock = PayCraftBackend.Mock(staticConfig = staticCfg)
        // If this client made any HTTP call the test would fail — the handler is unreachable.
        val http = httpClient { respondThrow(AssertionError("Mock backend must not hit HTTP")) }
        val client = ConfigClient(http, mock, apiKey = "ignored", cache = freshCache())

        val cfg = client.fetch()

        assertNotNull(cfg)
        assertEquals("mock-tenant", cfg.tenantId)
    }
}
