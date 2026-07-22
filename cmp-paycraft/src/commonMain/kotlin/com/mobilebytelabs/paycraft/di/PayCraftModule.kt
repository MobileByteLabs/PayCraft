package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.billing.WebCheckoutNativeBillingClient
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.EntitlementRepository
import com.mobilebytelabs.paycraft.core.PayCraftBillingManager
import com.mobilebytelabs.paycraft.network.CouponClient
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PayCraftServiceImpl
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.persistence.SettingsEntitlementDao
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallViewModel
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import org.koin.core.module.dsl.viewModelOf
import org.koin.core.qualifier.named
import org.koin.dsl.module

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
            install(Auth)
        }
    }

    single<PayCraftService> {
        PayCraftServiceImpl(
            client = get<SupabaseClient>(qualifier = named("paycraft")),
            // apiKey is set synchronously in PayCraft.initialize() — read it
            // directly instead of going through requireConfig() (which depends
            // on the async cloud fetch having finished).
            apiKey = PayCraft.apiKey
                ?: error("PayCraft.initialize(apiKey) must be called before resolving PayCraftService"),
        )
    }

    single<com.mobilebytelabs.paycraft.persistence.PayCraftStore> {
        com.mobilebytelabs.paycraft.persistence.PayCraftSettingsStore()
    }

    // ─── Phase 4: Store5 offline cache + restore/cancel orchestration ─────────

    // Default web-checkout native client (no native store on jvm/desktop/wasmJs/js/macos — D13).
    // Android/iOS consumers override this binding with the Phase-3 actual StoreKit2/Play client.
    single<NativeBillingClient> { WebCheckoutNativeBillingClient() }

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

    single<BillingManager> {
        PayCraftBillingManager(
            service = get(),
            store = get(),
            repo = get(),
        )
    }

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
