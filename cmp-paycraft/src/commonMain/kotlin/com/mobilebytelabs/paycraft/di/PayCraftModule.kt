package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.PayCraftBillingManager
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PayCraftServiceImpl
import com.mobilebytelabs.paycraft.ui.PayCraftPaywallViewModel
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.postgrest
import org.koin.core.module.dsl.viewModelOf
import org.koin.dsl.module

val PayCraftModule = module {
    single<SupabaseClient>(qualifier = org.koin.core.qualifier.named("paycraft")) {
        val config = PayCraft.requireConfig()
        createSupabaseClient(
            supabaseUrl = config.supabaseUrl,
            supabaseKey = config.supabaseAnonKey,
        ) {
            install(Postgrest)
        }
    }

    single<PayCraftService> {
        PayCraftServiceImpl(
            postgrest = get<SupabaseClient>(
                qualifier = org.koin.core.qualifier.named("paycraft"),
            ).postgrest,
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

    viewModelOf(::PayCraftPaywallViewModel)
}
