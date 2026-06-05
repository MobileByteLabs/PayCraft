package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.SuiteConfig

/**
 * Where PayCraft fetches its SuiteConfig (products + providers + pricing + paywall).
 *
 * - [Cloud]      — paycraft.cloud SaaS. Default for `PayCraft.initialize(apiKey)`.
 * - [SelfHosted] — Customer-operated Supabase + edge functions (Enterprise license).
 * - [Mock]       — In-process static SuiteConfig. For tests + offline previews.
 */
sealed interface PayCraftBackend {
    val supabaseUrl: String
    val supabaseAnonKey: String
    val configUrl: String

    data object Cloud : PayCraftBackend {
        override val supabaseUrl: String = CLOUD_SUPABASE_URL
        override val supabaseAnonKey: String = CLOUD_SUPABASE_ANON_KEY
        override val configUrl: String = "$CLOUD_SUPABASE_URL/functions/v1/config"
    }

    data class SelfHosted(
        override val supabaseUrl: String,
        override val supabaseAnonKey: String,
        val configPath: String = "/functions/v1/config",
    ) : PayCraftBackend {
        override val configUrl: String = "$supabaseUrl$configPath"
    }

    data class Mock(val staticConfig: SuiteConfig) : PayCraftBackend {
        override val supabaseUrl: String = "mock://"
        override val supabaseAnonKey: String = "mock"
        override val configUrl: String = "mock://"
    }

    companion object {
        const val CLOUD_SUPABASE_URL: String = "https://api.paycraft.cloud"
        // Public anon key for paycraft.cloud — embedded by build pipeline at release time.
        // (Anon key is safe to ship — RLS prevents data exposure.)
        const val CLOUD_SUPABASE_ANON_KEY: String =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.PUBLIC_PAYCRAFT_ANON_KEY_PLACEHOLDER"
    }
}
