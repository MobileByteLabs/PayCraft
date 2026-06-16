package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.PayCraftBillingManager
import com.mobilebytelabs.paycraft.network.CouponClient
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PayCraftServiceImpl
import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallViewModel
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import org.koin.core.module.dsl.viewModelOf
import org.koin.core.qualifier.named
import org.koin.dsl.module

val PayCraftModule = module {
    single<SupabaseClient>(qualifier = named("paycraft")) {
        val config = PayCraft.requireConfig()
        createSupabaseClient(
            supabaseUrl = config.supabaseUrl,
            supabaseKey = config.supabaseAnonKey,
        ) {
            install(Postgrest)
            install(Auth)
        }
    }

    single<PayCraftService> {
        PayCraftServiceImpl(
            client = get<SupabaseClient>(qualifier = named("paycraft")),
            apiKey = PayCraft.requireConfig().apiKey,
        )
    }

    single<com.mobilebytelabs.paycraft.persistence.PayCraftStore> {
        com.mobilebytelabs.paycraft.persistence.PayCraftSettingsStore()
    }

    single<BillingManager> {
        PayCraftBillingManager(
            service = get(),
            store = get(),
        )
    }

    single<HttpClient> {
        HttpClient {
            install(ContentNegotiation) {
                json(Json { ignoreUnknownKeys = true; explicitNulls = false })
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
