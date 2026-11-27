package com.mobilebytelabs.paycraft

import com.mobilebytelabs.paycraft.config.SuiteConfig

/**
 * Where PayCraft fetches its SuiteConfig (products + providers + pricing + paywall).
 *
 * - [Cloud]      — paycraft.mobilebytesensei.com SaaS. Default for `PayCraft.initialize(apiKey)`.
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
        // PayCraft Cloud's API — the edge proxy (PayCraft/edge/), a Cloudflare Worker in front of the Supabase
        // project. Apps never address supabase.co: the proxy carries REST, functions, auth, storage and realtime,
        // so the backend can move, and Cloudflare's WAF / rate limits apply, without an app update.
        const val CLOUD_SUPABASE_URL: String =
            "https://edge.paycraft.mobilebytesensei.com"

        // Public anon key for paycraft.mobilebytesensei.com — embedded by
        // build pipeline at release time. (Anon key is safe to ship — RLS
        // prevents data exposure.)
        const val CLOUD_SUPABASE_ANON_KEY: String =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6I" +
                "m1sd2ZneXRqeGxxeWZ4Y2dweXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MTk0ODU" +
                "sImV4cCI6MjA5MjQ5NTQ4NX0.q1L5IyffiRObM85yxBK5BFRFsTjObzUeQSCJB96WM1s"
    }
}
