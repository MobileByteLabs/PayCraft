package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.statement.HttpResponse
import io.ktor.http.isSuccess
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json

/**
 * Fetches [SuiteConfig] from the configured [PayCraftBackend] with offline-cache fallback.
 *
 * On success the response is decoded, timestamped, and written to [ConfigCache].
 * On any non-success status or thrown exception, the last-known cached value is returned
 * (or `null` if the cache is empty).
 */
@Deprecated(
    message = "Superseded by the resilience chain inside PayCraft.loadConfig(). This class was " +
        "never wired into the real fetch path — PayCraft performs an inline HTTP fetch to avoid " +
        "the Settings dependency — so its catch → cache.read() fallback never ran in production. " +
        "That shape now lives in PayCraft.fallBackThroughChain(), which additionally falls through " +
        "to a bundled fallback and a built-in paywall, and publishes ConfigResult so the UI can " +
        "tell a failure from a load. Collect PayCraft.configResultFlow instead. " +
        "Removed in cmp-paycraft 3.0.0.",
    level = DeprecationLevel.WARNING,
)
class ConfigClient(
    private val http: HttpClient,
    private val backend: PayCraftBackend,
    private val apiKey: String,
    private val cache: ConfigCache,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        // An explicit `null` for a non-nullable field with a default falls back to that default.
        //
        // Without this, kotlinx applies a default ONLY when the key is ABSENT — an explicit
        // `"template": null` throws. The config endpoint sends explicit nulls for every unset column
        // of a tenant that has not finished configuring its paywall (`tenant_id`, `template`,
        // `theme_jsonb`, `branding` …), so a brand-new tenant's config failed to decode ENTIRELY and
        // the SDK fell through every resilience layer to "Something went wrong" — on the very first
        // paywall its owner ever opened.
        coerceInputValues = true
    }

    /** Returns a fresh config, or the cache as fallback, or `null` if both unavailable. */
    suspend fun fetch(localeCountry: String = "US"): SuiteConfig? {
        if (backend is PayCraftBackend.Mock) return backend.staticConfig

        return try {
            val response: HttpResponse = http.get(backend.configUrl) {
                parameter("apiKey", apiKey)
                header("Accept-Language", "en-$localeCountry")
                // REQUIRED: `/config` resolves each product's store binding from
                // `tenant_routing_rules` for THIS platform — which provider the dashboard's
                // Platform-providers page names as primary, and the product id to use with it.
                // Without this header the server sees platform=null, matches no platform-scoped
                // rule, and returns no binding, so every native checkout fails "no provider
                // configured". That is precisely the bug this header's absence caused on
                // mbs/cappy (2026-09-17): routing rules said android -> google_play, the product
                // had a synced play id, and checkout still refused because the server was never
                // told which platform was asking.
                header("x-paycraft-platform", PlatformInfo.platform)
            }
            if (!response.status.isSuccess()) {
                return cache.read()
            }
            val raw: String = response.body()
            val cfg = json.decodeFromString(SuiteConfig.serializer(), raw)
                .copy(fetchedAtEpochMillis = currentTimeMillis())
            cache.write(cfg)
            cfg
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            cache.read()
        }
    }
}
