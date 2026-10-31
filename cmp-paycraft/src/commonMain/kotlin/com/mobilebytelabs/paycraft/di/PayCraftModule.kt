package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.WebCheckoutNativeBillingClient
import com.mobilebytelabs.paycraft.billing.platformDefaultNativeBillingClient
import com.mobilebytelabs.paycraft.config.ConfigCache
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.EntitlementRepository
import com.mobilebytelabs.paycraft.core.PayCraftBillingManager
import com.mobilebytelabs.paycraft.network.CouponClient
import com.mobilebytelabs.paycraft.network.PayCraftRealtime
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PayCraftServiceImpl
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.persistence.SettingsEntitlementDao
import com.mobilebytelabs.paycraft.repository.PayCraftRepository
import com.mobilebytelabs.paycraft.repository.PayCraftRepositoryImpl
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallViewModel
import com.russhwolf.settings.Settings
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.realtime.Realtime
import io.github.mobilebytelabs.supabaseauth.compose.kmpSupabaseAuthInstall
import io.github.mobilebytelabs.supabaseauth.kmpSupabaseAuthClientFor
import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import org.koin.core.module.dsl.viewModelOf
import org.koin.core.qualifier.named
import org.koin.dsl.module

/** Koin qualifier of PayCraft's own native-sign-in client. */
internal const val PAYCRAFT_AUTH = "paycraft-auth"

val PayCraftModule = module {
    single<SupabaseClient>(qualifier = named("paycraft")) {
        // Supabase coords are known the moment PayCraft.initialize() returns:
        // Cloud has them as static constants on PayCraftBackend; SelfHosted
        // captures them in the data class. We must NOT call requireConfig()
        // here — config is populated only AFTER the async cloud SuiteConfig
        // fetch resolves, which happens later than Koin's lazy singleton
        // materialization (e.g. paywall ViewModel resolution).
        val backend = PayCraft.backend
        createSupabaseClient(
            supabaseUrl = backend.supabaseUrl,
            supabaseKey = backend.supabaseAnonKey,
        ) {
            install(Postgrest)
            // Auth WITH native Apple / Google (ComposeAuth) — kmp-supabase-auth installs Auth itself,
            // so this replaces a bare install(Auth); a second install would replace the first.
            kmpSupabaseAuthInstall(PayCraft.nativeAuthConfig)(this)
            install(Realtime)
        }
    }

    // PayCraft's sign-in client, NOT bound to KmpSupabaseAuthClient's type in the host's graph: the
    // host app may use kmp-supabase-auth for its own sign-in, and that binding is its, not ours.
    single(qualifier = named(PAYCRAFT_AUTH)) {
        kmpSupabaseAuthClientFor(get(qualifier = named("paycraft")), PayCraft.nativeAuthConfig)
    }

    single<PayCraftService> {
        PayCraftServiceImpl(
            client = get<SupabaseClient>(qualifier = named("paycraft")),
            // apiKey is set synchronously in PayCraft.initialize() — read it directly instead of
            // going through requireConfig() (which depends on the async cloud fetch having finished).
            //
            // NULLABLE ON PURPOSE, and this used to `error(...)` instead. That turned the SDK's
            // initialization order into the HOST's problem: any DI graph that materialized
            // BillingManager before PayCraft.initialize() crashed the app at start-up with
            // "PayCraft.initialize(apiKey) must be called before resolving PayCraftService". Hosts
            // do not control when their DI container resolves a singleton — a generated logout
            // registry that eagerly touches every store is enough to lose that race, which is
            // exactly how it was hit on device (cappy, CPH2423).
            //
            // PayCraftServiceImpl already treats apiKey as optional (`apiKey?.let { put(...) }` at
            // every call site), so an unconfigured service simply omits the key and the RPCs resolve
            // no tenant — a Free entitlement, which is the correct answer for an app with no key.
            // Callers that need to know can ask PayCraft.isConfigured.
            apiKey = PayCraft.apiKey,
        )
    }

    single<com.mobilebytelabs.paycraft.persistence.PayCraftStore> {
        com.mobilebytelabs.paycraft.persistence.PayCraftSettingsStore()
    }

    // Realtime push (broadcast) — refetch /config + force entitlement refresh on
    // server-side change instead of waiting for the cache-TTL/foreground poll.
    single { PayCraftRealtime(get<SupabaseClient>(qualifier = named("paycraft"))) }

    // ─── Phase 4: Store5 offline cache + restore/cancel orchestration ─────────

    // Native billing client, resolved PER PLATFORM automatically so a
    // commonMain-only consumer gets the right client with no androidMain wiring:
    //   Android → real Google Play Billing v8 (context + Activity auto-captured by
    //             PayCraftInitializer);  iOS/web/desktop → web checkout (null here).
    // iOS StoreKit2 + a custom Android activityProvider remain opt-in overrides via
    // paycraftPlayBillingModule loaded afterwards (iOS needs no opt-in module — its StoreKit 2
    // shim is SDK-internal).
    single<NativeBillingClient> { platformDefaultNativeBillingClient() ?: WebCheckoutNativeBillingClient() }

    // Store5 read-through cache — Fetcher(/entitlements) + SourceOfTruth(offline last-known-good).
    single {
        EntitlementCache(
            service = get(),
            dao = SettingsEntitlementDao(),
        )
    }

    single {
        EntitlementRepository(
            cache = get(),
            native = get(),
            service = get(),
        )
    }

    // The ONE data surface a consumer app resolves (RULE-PAYCRAFT-SINGLE-SURFACE-001). Bound here so
    // an integrator wires `PayCraft.initialize` and nothing else — no consumer-authored repository,
    // which is the 670 LOC/consumer this facade removes.
    // The APP-level facade. Stateless delegation, so a plain singleton is right — see PayCraftApiImpl.
    single<com.mobilebytelabs.paycraft.repository.PayCraftApi> {
        com.mobilebytelabs.paycraft.repository.PayCraftApiImpl()
    }

    single<PayCraftRepository> {
        PayCraftRepositoryImpl(
            billing = get(),
            entitlements = get(),
        )
    }

    single<BillingManager> {
        PayCraftBillingManager(
            service = get(),
            store = get(),
            repo = get(),
            identity = getOrNull(qualifier = named(PAYCRAFT_AUTH)),
            // The NativeBillingClient defaults to WebCheckoutNativeBillingClient (no-op) and is
            // OVERRIDDEN on Android by paycraftPlayBillingModule → PlayBillingNativeClient, so the
            // Payments-policy Play Billing lane is live once that module is loaded.
            nativeBillingClient = get(),
        )
    }

    /**
     * Persistent config cache (RT-2). Shipped unused since it was written — the inline fetch in
     * PayCraft.kt decoded straight into memory with a "persistent cache is a TODO" note, so the
     * SDK's offline story existed only on paper. Wiring it here is what makes a cold or offline
     * start render real products instead of a skeleton.
     */
    single { ConfigCache(Settings()) }

    single<HttpClient> {
        HttpClient {
            install(ContentNegotiation) {
                json(
                    Json {
                        ignoreUnknownKeys = true
                        explicitNulls = false
                    },
                )
            }
        }
    }

    single<CouponClient> {
        CouponClient(
            httpClient = get(),
            backend = PayCraft.backend,
        )
    }

    viewModelOf(::PayCraftPaywallViewModel)
}
