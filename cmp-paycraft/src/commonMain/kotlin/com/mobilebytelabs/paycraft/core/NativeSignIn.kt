package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.config.AuthClientsDto
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import io.github.jan.supabase.createSupabaseClient
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthClient
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthConfig
import io.github.mobilebytelabs.supabaseauth.compose.kmpSupabaseAuthInstall
import io.github.mobilebytelabs.supabaseauth.kmpSupabaseAuthClientFor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * PayCraft's OWN native Apple / Google sign-in — built entirely inside the SDK from the app's sign-in
 * clients that `/config` delivers (`auth`, migration 167). The consumer passes nothing.
 *
 * A DEDICATED client, not the SDK's data client, because native sign-in is configured at install time
 * (ComposeAuth's `googleNativeLogin(serverClientId)`) and the ids are only known once config lands —
 * after the data client must already exist for RPCs. So it is built on the first config that carries
 * an `auth` block (cached config on every launch after the first), and [client] emits it.
 *
 * Built ONCE per process: an id changed in the dashboard applies on the next launch.
 * ponytail: rebuild-on-change if operators ever edit ids on live apps mid-session.
 */
internal object NativeSignIn {
    private val _client = MutableStateFlow<KmpSupabaseAuthClient?>(null)
    val client: StateFlow<KmpSupabaseAuthClient?> = _client.asStateFlow()

    /** The config [client] was built with — null until then. */
    var config: KmpSupabaseAuthConfig? = null
        private set

    fun onConfig(auth: AuthClientsDto?, backend: PayCraftBackend) {
        if (auth == null || _client.value != null) return
        val cfg = configFor(auth, backend.supabaseUrl, PlatformInfo.appId)
        runCatching {
            val supabase = createSupabaseClient(backend.supabaseUrl, backend.supabaseAnonKey) {
                kmpSupabaseAuthInstall(cfg)(this)
            }
            config = cfg
            _client.value = kmpSupabaseAuthClientFor(supabase, cfg)
        }.onFailure { PayCraftLogger.onError("nativeSignIn", "build failed: ${it.message}") }
    }

    /**
     * The redirect PATH `/paycraft` keeps PayCraft's callback apart from the host's own sign-in on the
     * shared Android callback (kmp-supabase-auth ≥ 0.3.4 routes by path).
     */
    fun configFor(auth: AuthClientsDto, supabaseUrl: String, appId: String) = KmpSupabaseAuthConfig(
        projectRef = supabaseUrl.substringAfter("://").substringBefore('.'),
        googleWebClientId = auth.googleWebClientId.orEmpty(),
        appleServiceId = auth.appleServicesId.orEmpty(),
        redirectUrl = if (appId.isBlank()) "" else "$appId://login-callback/paycraft",
    )
}
