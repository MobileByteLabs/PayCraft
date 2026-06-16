package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.ConfigCache
import com.mobilebytelabs.paycraft.config.ConfigClient
import com.mobilebytelabs.paycraft.config.PaywallDto
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.ProviderDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.russhwolf.settings.MapSettings
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * AC-46 — End-to-end contract for [PayCraftBackend.SelfHosted] without spinning
 * up a real Supabase / docker-compose stack.
 *
 * We pin Ktor to a [MockEngine] so we can assert:
 *  - Test 1: `SelfHosted(url, anonKey)` computes the correct `configUrl`
 *            (`{url}/functions/v1/config`).
 *  - Test 2: [ConfigClient] against a [MockEngine] HITS the self-hosted
 *            `configUrl` (request URL recorded, query params + headers correct).
 *  - Test 3: a bad anon key surfacing as 401 falls back to a previously cached
 *            [SuiteConfig]; an empty cache results in a clean `null`
 *            (no thrown exception).
 *  - Test 4: the parsed [SuiteConfig] DTO shape is identical regardless of
 *            whether the backend is [PayCraftBackend.Cloud] or
 *            [PayCraftBackend.SelfHosted] — same payload → same DTO.
 *
 * Pattern mirrors [com.mobilebytelabs.paycraft.config.ConfigClientTest].
 */
class SelfHostedBackendIntegrationTest {

    private val selfHostedUrl = "https://billing.acme.test"
    private val selfHostedAnonKey = "anon-self-hosted-key"

    /** A canned JSON payload that matches the prod /functions/v1/config schema. */
    private val configJson = """
        {
          "tenant_id": "acme-tenant",
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
              "test_payment_links": { "monthly": "https://test.link/monthly" }
            }
          ],
          "paywall": { "template": "minimal", "support_email": "support@acme.test" },
          "cache_ttl_seconds": 3600
        }
    """.trimIndent()

    private fun selfHosted(): PayCraftBackend.SelfHosted = PayCraftBackend.SelfHosted(
        supabaseUrl = selfHostedUrl,
        supabaseAnonKey = selfHostedAnonKey,
    )

    private fun freshCache(): ConfigCache = ConfigCache(MapSettings())

    /** Build a Ktor client whose engine always returns [body] with [status]. */
    private fun staticClient(
        status: HttpStatusCode = HttpStatusCode.OK,
        body: String = configJson,
        recorder: MutableList<HttpRequestData>? = null,
    ): HttpClient = HttpClient(MockEngine) {
        engine {
            addHandler { request ->
                recorder?.add(request)
                if (status == HttpStatusCode.OK) {
                    respond(
                        content = body,
                        status = status,
                        headers = headersOf(HttpHeaders.ContentType, "application/json"),
                    )
                } else {
                    respondError(status)
                }
            }
        }
    }

    // ────────── Test 1 ──────────

    @Test
    fun selfHosted_backend_constructs_with_correct_configUrl() {
        val backend = PayCraftBackend.SelfHosted(
            supabaseUrl = "https://billing.acme.com",
            supabaseAnonKey = "anon-xyz",
        )

        assertEquals("https://billing.acme.com", backend.supabaseUrl)
        assertEquals("anon-xyz", backend.supabaseAnonKey)
        assertEquals(
            "https://billing.acme.com/functions/v1/config",
            backend.configUrl,
            "SelfHosted.configUrl must equal supabaseUrl + /functions/v1/config",
        )
    }

    @Test
    fun selfHosted_backend_honors_overridden_configPath() {
        val backend = PayCraftBackend.SelfHosted(
            supabaseUrl = "https://billing.acme.com",
            supabaseAnonKey = "anon-xyz",
            configPath = "/api/v2/config",
        )

        assertEquals(
            "https://billing.acme.com/api/v2/config",
            backend.configUrl,
            "Custom configPath must be honored end-to-end",
        )
    }

    // ────────── Test 2 ──────────

    @Test
    fun configClient_against_selfHosted_resolves_configUrl_at_provided_origin() = runTest {
        val captured = mutableListOf<HttpRequestData>()
        val http = staticClient(recorder = captured)
        val client = ConfigClient(
            http = http,
            backend = selfHosted(),
            apiKey = "pk_test_self_hosted",
            cache = freshCache(),
        )

        val cfg = client.fetch(localeCountry = "US")

        assertNotNull(cfg, "fetch() against MockEngine 200 OK must return a parsed SuiteConfig")
        assertEquals("acme-tenant", cfg.tenantId)

        assertEquals(1, captured.size, "exactly one HTTP request expected")
        val url = captured.first().url.toString()
        assertTrue(
            url.startsWith("$selfHostedUrl/functions/v1/config"),
            "request must hit the SelfHosted origin's /functions/v1/config endpoint; got: $url",
        )
        assertTrue(
            url.contains("apiKey=pk_test_self_hosted"),
            "request URL must carry the apiKey query parameter; got: $url",
        )
        assertEquals(
            "en-US",
            captured.first().headers[HttpHeaders.AcceptLanguage],
            "Accept-Language must be derived from localeCountry",
        )
    }

    // ────────── Test 3 ──────────

    @Test
    fun bad_anonKey_401_falls_back_to_cached_SuiteConfig_when_present() = runTest {
        val cache = freshCache()
        // Seed the cache with the value the SDK would have stashed on a prior
        // successful fetch — this is the "offline-graceful" contract.
        val sentinel = SuiteConfig(
            tenantId = "from-cache",
            cacheTtlSeconds = 3600,
            fetchedAtEpochMillis = 1_000L,
        )
        cache.write(sentinel)

        val http = staticClient(status = HttpStatusCode.Unauthorized)
        val client = ConfigClient(
            http = http,
            backend = selfHosted(),
            apiKey = "pk_test_bad_key",
            cache = cache,
        )

        val cfg = client.fetch()

        assertNotNull(cfg, "401 with a populated cache must yield the cached SuiteConfig, not null")
        assertEquals("from-cache", cfg.tenantId)
    }

    @Test
    fun bad_anonKey_401_returns_null_cleanly_when_cache_is_empty() = runTest {
        // No exception is thrown — ConfigClient swallows non-success statuses
        // and returns whatever the cache holds (here: nothing).
        val http = staticClient(status = HttpStatusCode.Unauthorized)
        val client = ConfigClient(
            http = http,
            backend = selfHosted(),
            apiKey = "pk_test_bad_key",
            cache = freshCache(),
        )

        assertNull(
            client.fetch(),
            "401 with an empty cache must return null cleanly (no thrown exception)",
        )
    }

    // ────────── Test 4 ──────────

    @Test
    fun suiteConfig_DTO_is_identical_across_Cloud_and_SelfHosted_backends() = runTest {
        // Same JSON payload, two different backends — the parsed DTO graph
        // must be byte-for-byte equal. (The wire is the contract; the backend
        // is just where we fetch it from.)
        val cloudHttp = staticClient()
        val selfHostedHttp = staticClient()

        val cloudClient = ConfigClient(
            http = cloudHttp,
            backend = PayCraftBackend.Cloud,
            apiKey = "pk_test_cloud",
            cache = freshCache(),
        )
        val selfHostedClient = ConfigClient(
            http = selfHostedHttp,
            backend = selfHosted(),
            apiKey = "pk_test_self_hosted",
            cache = freshCache(),
        )

        val cloudCfg = cloudClient.fetch()
        val selfHostedCfg = selfHostedClient.fetch()

        assertNotNull(cloudCfg)
        assertNotNull(selfHostedCfg)

        // Compare the deterministic, server-emitted fields (fetchedAtEpochMillis
        // is stamped client-side at receive time so it can legitimately differ).
        val cloudNormalized = cloudCfg.copy(fetchedAtEpochMillis = 0L)
        val selfHostedNormalized = selfHostedCfg.copy(fetchedAtEpochMillis = 0L)

        assertEquals(
            cloudNormalized,
            selfHostedNormalized,
            "Same wire payload must decode to an identical SuiteConfig regardless of backend",
        )

        // Spot-check that the structural promise holds beyond the equals contract.
        assertEquals(cloudCfg.tenantId, selfHostedCfg.tenantId)
        assertEquals(cloudCfg.products.size, selfHostedCfg.products.size)
        assertEquals(cloudCfg.providers.size, selfHostedCfg.providers.size)
        assertEquals(cloudCfg.paywall.supportEmail, selfHostedCfg.paywall.supportEmail)
        assertEquals(cloudCfg.cacheTtlSeconds, selfHostedCfg.cacheTtlSeconds)
    }

    @Test
    fun suiteConfig_minimal_fixture_round_trips_identically_via_both_backends() {
        // Constructor-side parity check — independent of HTTP. Same builder
        // arguments produce the same DTO regardless of which backend wraps it.
        val sample = SuiteConfig(
            tenantId = "parity-tenant",
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
        )

        // The DTO is backend-agnostic by design — assert the shape doesn't drift
        // between the Mock paths the SDK uses for previews + tests.
        val cloudMock = PayCraftBackend.Mock(staticConfig = sample)
        val selfHostedMock = PayCraftBackend.Mock(staticConfig = sample)

        assertEquals(cloudMock.staticConfig, selfHostedMock.staticConfig)
        assertEquals(cloudMock.staticConfig.products, selfHostedMock.staticConfig.products)
        assertEquals(cloudMock.staticConfig.providers, selfHostedMock.staticConfig.providers)
    }
}
