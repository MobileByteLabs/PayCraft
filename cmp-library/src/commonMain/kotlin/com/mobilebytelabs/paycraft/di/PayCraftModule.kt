package com.mobilebytelabs.paycraft.di

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.PayCraftBillingManager
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PayCraftServiceImpl
import io.github.jan.supabase.SupabaseClient
import io.github.jan.supabase.createSupabaseClient
import io.github.jan.supabase.postgrest.Postgrest
import io.github.jan.supabase.postgrest.postgrest
import io.github.jan.supabase.serializer.KotlinXSerializer
import kotlinx.serialization.json.Json
import org.koin.dsl.module

private val payCraftJson = Json {
    coerceInputValues = true
    ignoreUnknownKeys = true
    isLenient = true
    encodeDefaults = true
}

val PayCraftModule = module {
    single<SupabaseClient>(qualifier = org.koin.core.qualifier.named("paycraft")) {
        val config = PayCraft.requireConfig()
        createSupabaseClient(
            supabaseUrl = config.supabaseUrl,
            supabaseKey = config.supabaseAnonKey,
        ) {
            defaultSerializer = KotlinXSerializer(payCraftJson)
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

    single<BillingManager> {
        PayCraftBillingManager(
            service = get(),
            store = get(),
        )
    }
}
