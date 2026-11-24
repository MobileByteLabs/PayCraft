package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.ConfigCache
import com.mobilebytelabs.paycraft.config.ConfigResult
import com.mobilebytelabs.paycraft.config.ProductDto
import com.mobilebytelabs.paycraft.config.SuiteConfig
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.MonetizationMode
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.debug.payCraftScope
import com.mobilebytelabs.paycraft.di.PayCraftIdentityBinder
import com.mobilebytelabs.paycraft.network.PayCraftRealtime
import com.mobilebytelabs.paycraft.repository.FakePayCraftRepository
import com.russhwolf.settings.MapSettings
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpStatusCode
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Nothing the SDK does at app start — or in background billing work — may throw into the host.
 *
 * v3.0.2 shipped the counter-example: `initialize` threw from an eager Koin singleton inside
 * Application.onCreate and the app was unusable. Each test here is one other way the same class
 * of crash could happen; each asserts "returns normally" plus, where it applies, that the failure
 * became VISIBLE (configResultFlow / PayCraft.lastError) instead of silently leaving the user Free.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class StartupCrashSafetyTest {

    @BeforeTest
    fun reset() {
        runCatching { stopKoin() }
        PayCraft.resetConfigStateForTesting()
    }

    @AfterTest
    fun tearDown() {
        runCatching { stopKoin() }
    }

    // A transport that never answers within a test: the async revalidation can neither reach the
    // real network nor overwrite lastError before a test reads it.
    private fun silentHttp() = HttpClient(
        MockEngine {
            delay(60_000)
            respondError(HttpStatusCode.GatewayTimeout)
        },
    )

    private fun suite() = SuiteConfig(
        tenantId = "tenant-crash",
        products = listOf(
            ProductDto(id = "p1", sku = "pro-monthly", type = "subscription", displayName = "Pro"),
        ),
        cacheTtlSeconds = 3_600,
        fetchedAtEpochMillis = 1L,
    )

    @Test
    fun malformed_config_json_degrades_to_a_visible_failure() = runTest {
        startKoin {
            modules(
                module {
                    single { HttpClient(MockEngine { respond("{ \"products\": [ not json") }) }
                    single { ConfigCache(MapSettings()) }
                },
            )
        }

        PayCraft.initialize(apiKey = "pk_test_crash", backend = PayCraftBackend.Cloud)
        PayCraft.refreshConfig()
        awaitNonLoading()

        val result = PayCraft.configResultFlow.value
        assertTrue(result is ConfigResult.Failed, "garbage /config must end Failed, got $result")
        assertEquals(ConfigResult.Failed.Reason.DECODE_ERROR, result.reason)
        assertEquals("loadConfig", PayCraft.lastError.value?.source, "the failure must reach lastError")
    }

    @Test
    fun corrupted_persisted_config_does_not_crash_initialize() {
        val settings = MapSettings().apply { putString("paycraft.suite_config", "\u0000{{corrupt") }
        startKoin {
            modules(
                module {
                    single { ConfigCache(settings) }
                    single { silentHttp() }
                },
            )
        }

        PayCraft.initialize(apiKey = "pk_test_crash", backend = PayCraftBackend.Cloud)
        // returning is the assertion
    }

    @Test
    fun a_koin_definition_that_fails_to_construct_does_not_crash_a_warm_start() {
        // Warm start applies the cached config synchronously inside initialize(), and applying it
        // resolves realtime. Koin's getOrNull RETHROWS a definition that fails to construct — this
        // was an Application.onCreate crash on every launch that had a cached config.
        val settings = MapSettings()
        ConfigCache(settings).write(suite())
        startKoin {
            modules(
                module {
                    single { ConfigCache(settings) }
                    single { silentHttp() }
                    single<PayCraftRealtime> { error("supabase client failed to build") }
                },
            )
        }

        PayCraft.initialize(apiKey = "pk_test_crash", backend = PayCraftBackend.Cloud)

        assertEquals("pro-monthly", PayCraft.suiteConfig?.products?.firstOrNull()?.sku, "cache still served")
        assertEquals("realtime", PayCraft.lastError.value?.source)
    }

    @Test
    fun initialize_twice_and_concurrently_never_throws() = runTest {
        startKoin {
            modules(
                module {
                    single { ConfigCache(MapSettings()) }
                    single { silentHttp() }
                },
            )
        }
        PayCraft.initialize(apiKey = "pk_test_a", backend = PayCraftBackend.Cloud)
        PayCraft.initialize(apiKey = "pk_test_b", backend = PayCraftBackend.Cloud)
        withContext(Dispatchers.Default) {
            List(16) { i ->
                launch { PayCraft.initialize(apiKey = "pk_test_$i", backend = PayCraftBackend.Cloud) }
            }.forEach { it.join() }
        }
        assertTrue(PayCraft.isConfigured)
    }

    @Test
    fun foreground_signal_survives_a_billing_manager_that_fails_to_construct() {
        startKoin { modules(module { single<BillingManager> { error("graph not ready") } }) }
        PayCraft.initialize(apiKey = "pk_test_crash", backend = PayCraftBackend.Mock(staticConfig = suite()))

        PayCraft.onAppForegrounded() // main-thread lifecycle callback — must not throw

        assertEquals("onAppForegrounded", PayCraft.lastError.value?.source)
    }

    @Test
    fun an_uncaught_exception_in_an_sdk_scope_is_logged_not_rethrown() = runTest {
        val scope = payCraftScope(StandardTestDispatcher(testScheduler))
        scope.launch { error("background billing work failed") }
        advanceUntilIdle()

        val err = PayCraftLogger.lastError.value
        assertEquals("uncaught", err?.source)
        assertTrue(err?.message.orEmpty().contains("background billing work failed"))
    }

    @Test
    fun a_failing_identity_bind_does_not_stop_later_binds() = runTest(UnconfinedTestDispatcher()) {
        val repo = FakePayCraftRepository()
        var calls = 0
        val emails = MutableStateFlow<String?>(null)
        PayCraftIdentityBinder(
            email = emails,
            // First resolution blows up (a Koin definition failing mid-start), later ones work.
            repository = { if (calls++ == 0) error("repository not ready") else repo },
            store = { null },
            apiKey = "pk_test_binder",
            testApiKey = null,
            backend = PayCraftBackend.Mock(staticConfig = suite()),
            options = InitOptions(),
            mode = MonetizationMode.AdSupported,
            scope = backgroundScope,
        )
        emails.value = "first@example.com"
        emails.value = "second@example.com"
        advanceUntilIdle()

        assertEquals(listOf("second@example.com"), repo.logInCalls)
    }

    private suspend fun awaitNonLoading(maxPolls: Int = 300) {
        withContext(Dispatchers.Default) {
            repeat(maxPolls) {
                if (!PayCraft.configResultFlow.value.isLoading) return@withContext
                delay(10)
            }
        }
    }
}
