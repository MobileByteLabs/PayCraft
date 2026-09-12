package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.PayCraftBackend
import com.russhwolf.settings.MapSettings
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respondError
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * AC-20..AC-24 — the four-layer resilience chain, exercised through the REAL fetch path.
 *
 * The transport is injected via Koin, which is the same seam `configHttpClient()` already prefers,
 * so no production code exists solely to make these tests possible. That matters for AC-24
 * specifically: the plan called it out because a static grep for a cache reference passes even when
 * the reference sits behind a branch that never runs — which is precisely the state HEAD was in.
 * These assert on `configResultFlow` after driving `refreshConfig()`, so a dead branch fails.
 */
class ResilienceChainTest {

    @BeforeTest
    fun resetSingletonState() {
        // PayCraft is an `object`, so config state survives between tests. Without this reset the
        // terminal-failure test sees products left by an earlier test and layer 4 correctly answers
        // BuiltIn — the branch under test becomes unreachable rather than broken.
        runCatching { stopKoin() }
        PayCraft.resetConfigStateForTesting()
    }

    @AfterTest
    fun tearDown() {
        runCatching { stopKoin() }
    }

    private fun failingHttpClient(status: HttpStatusCode = HttpStatusCode.InternalServerError) =
        HttpClient(MockEngine { respondError(status) }) {
            install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; isLenient = true }) }
        }

    private fun cachedConfig(ttlSeconds: Int, fetchedAtMillis: Long) = SuiteConfig(
        tenantId = "tenant-under-test",
        products = listOf(
            ProductDto(
                id = "p1", sku = "premium_monthly", type = "subscription",
                displayName = "Premium", interval = "month",
                basePriceCents = 499, baseCurrency = "USD",
            ),
        ),
        cacheTtlSeconds = ttlSeconds,
        fetchedAtEpochMillis = fetchedAtMillis,
    )

    private fun startKoinWith(http: HttpClient, settings: MapSettings) {
        startKoin {
            modules(
                module {
                    single { http }
                    single { ConfigCache(settings) }
                },
            )
        }
    }

    // ── AC-24 — the keystone ────────────────────────────────────────────────────────────────
    @Test
    fun http_failure_falls_back_to_the_persisted_cache() = runTest {
        val settings = MapSettings()
        val cache = ConfigCache(settings)
        cache.write(cachedConfig(ttlSeconds = 3_600, fetchedAtMillis = 1L))
        startKoinWith(failingHttpClient(), settings)

        PayCraft.initialize(apiKey = "pk_test_resilience", backend = PayCraftBackend.Cloud)
        PayCraft.refreshConfig()
        awaitNonLoading()

        val result = PayCraft.configResultFlow.value
        assertTrue(
            result is ConfigResult.Cached || result is ConfigResult.Stale,
            "expected the cache layer to answer an HTTP failure, got $result",
        )
        assertEquals("premium_monthly", result.configOrNull?.products?.firstOrNull()?.sku)
        // The whole point: something renders. A null config is what held the skeleton forever.
        assertFalse(result.isLoading, "an HTTP failure must not leave the paywall in Loading")
    }

    // ── AC-21 — staleness is surfaced, not silently served as fresh ─────────────────────────
    @Test
    fun an_expired_cache_is_reported_as_stale() = runTest {
        val settings = MapSettings()
        // TTL of 1s with a fetch timestamp at the epoch — unambiguously expired.
        ConfigCache(settings).write(cachedConfig(ttlSeconds = 1, fetchedAtMillis = 1L))
        startKoinWith(failingHttpClient(), settings)

        PayCraft.initialize(apiKey = "pk_test_resilience", backend = PayCraftBackend.Cloud)
        PayCraft.refreshConfig()
        awaitNonLoading()

        val result = PayCraft.configResultFlow.value
        assertTrue(result is ConfigResult.Stale, "expected Stale for an expired cache, got $result")
        assertTrue(result.isStale)
        assertTrue(result.ageSeconds > 0, "stale age should be positive")
    }

    // ── AC-22 — a total failure reaches the UI as a terminal state, not a spinner ───────────
    @Test
    fun total_failure_emits_a_terminal_state_rather_than_loading() = runTest {
        val settings = MapSettings() // empty cache, and no bundled fallback on the test target
        startKoinWith(failingHttpClient(HttpStatusCode.BadGateway), settings)

        PayCraft.initialize(apiKey = "pk_test_resilience", backend = PayCraftBackend.Cloud)
        PayCraft.refreshConfig()
        awaitNonLoading()

        val result = PayCraft.configResultFlow.value
        assertFalse(result.isLoading, "a 502 must not leave the paywall in Loading forever")
        assertTrue(result is ConfigResult.Failed, "expected Failed with nothing cached, got $result")
        assertEquals(ConfigResult.Failed.Reason.HTTP_ERROR, result.reason)
        assertTrue(result.isRetryable, "an HTTP error may be transient — retry should be offered")
    }

    // ── AC-23 — layer isolation: the cache answers before the lower layers are consulted ────
    @Test
    fun a_valid_cache_short_circuits_the_lower_layers() = runTest {
        val settings = MapSettings()
        ConfigCache(settings).write(cachedConfig(ttlSeconds = 86_400, fetchedAtMillis = 1L))
        startKoinWith(failingHttpClient(), settings)

        PayCraft.initialize(apiKey = "pk_test_resilience", backend = PayCraftBackend.Cloud)
        PayCraft.refreshConfig()
        awaitNonLoading()

        val result = PayCraft.configResultFlow.value
        // Not Bundled and not BuiltIn: reaching those would mean the chain skipped the user's own
        // data in favour of something the developer guessed at build time.
        assertTrue(
            result !is ConfigResult.Bundled && result !is ConfigResult.BuiltIn,
            "a usable cache must win over the lower layers, got $result",
        )
    }

    @Test
    fun failed_carries_a_reason_the_ui_can_word_differently() {
        val offline = ConfigResult.Failed(ConfigResult.Failed.Reason.OFFLINE)
        val decode = ConfigResult.Failed(ConfigResult.Failed.Reason.DECODE_ERROR)
        val notInit = ConfigResult.Failed(ConfigResult.Failed.Reason.NOT_INITIALIZED)
        assertTrue(offline.isRetryable)
        // Retry cannot fix a malformed response or a billing stack that never started — offering it
        // in either case is a dead button. The code, its own comment, and this assertion disagreed
        // about DECODE_ERROR until the audit surfaced it.
        assertFalse(decode.isRetryable)
        assertFalse(notInit.isRetryable)
    }

    @Test
    fun loading_is_the_only_state_a_spinner_is_honest_for() {
        assertTrue(ConfigResult.Loading.isLoading)
        for (r in listOf(
            ConfigResult.BuiltIn,
            ConfigResult.Failed(ConfigResult.Failed.Reason.OFFLINE),
            ConfigResult.Cached(cachedConfig(3_600, 1L)),
            ConfigResult.Stale(cachedConfig(0, 1L), 99L),
            ConfigResult.Bundled(cachedConfig(0, 1L)),
            ConfigResult.Fresh(cachedConfig(3_600, 1L)),
        )) {
            assertFalse(r.isLoading, "$r must not render a spinner")
        }
    }

    /**
     * Waits for the async fetch to settle.
     *
     * The delay runs on Dispatchers.Default deliberately. `runTest` installs a virtual-time
     * scheduler, so a plain `delay()` here returns instantly and the loop spins 200 times in no
     * real time at all — while the fetch, launched on PayCraft's own application scope, has not
     * run. That is what made the terminal-failure case look like "still Loading": the assertion was
     * right and the wait was fake. The cached cases masked it because `initialize()` publishes the
     * cache synchronously.
     */
    private suspend fun awaitNonLoading(maxPolls: Int = 300) {
        withContext(Dispatchers.Default) {
            repeat(maxPolls) {
                if (!PayCraft.configResultFlow.value.isLoading) return@withContext
                delay(10)
            }
        }
    }
}
