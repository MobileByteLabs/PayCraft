package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.di.PAYCRAFT_AUTH
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthClient
import io.github.mobilebytelabs.supabaseauth.compose.rememberKmpSupabaseAppleSignIn
import io.github.mobilebytelabs.supabaseauth.compose.rememberKmpSupabaseGoogleSignIn
import org.koin.core.qualifier.named
import org.koin.mp.KoinPlatform

/** What the identity screens render: a launcher, and which providers it can actually complete. */
internal class PayCraftSignIn(val launch: (OAuthProvider) -> Unit, val providers: Set<OAuthProvider>)

/**
 * The sign-in PayCraft's identity screens (restore, device conflict, post-purchase link) use.
 *
 * The host's [LocalPayCraftOAuthHandler] wins when provided. Otherwise this is NATIVE sign-in by
 * default (PLAN-paycraft-native-identity D2): Apple via `ASAuthorization` on iOS, Google via Credential
 * Manager on Android, each through kmp-supabase-auth on PayCraft's OWN Supabase client. Completion is
 * observed by the billing manager from the session, not from here.
 *
 * Apple is offered on iOS always (native, no secret) and elsewhere only with an Apple Services ID —
 * the web flow cannot complete without one, and a button that cannot finish is worse than none.
 *
 * Null = nothing can sign in (no Koin graph, PayCraft unconfigured) — callers render no buttons.
 */
@Composable
internal fun rememberPayCraftSignIn(): PayCraftSignIn? {
    LocalPayCraftOAuthHandler.current?.let { host ->
        return remember(host) { PayCraftSignIn(host, OAuthProvider.entries.toSet()) }
    }
    val client = remember {
        runCatching { KoinPlatform.getKoinOrNull()?.getOrNull<KmpSupabaseAuthClient>(named(PAYCRAFT_AUTH)) }
            .getOrNull()
    }
    if (client == null || !client.isConfigured) return null

    val apple =
        rememberKmpSupabaseAppleSignIn(client = client, onError = { PayCraftLogger.onError("signIn", "apple: $it") })
    val google =
        rememberKmpSupabaseGoogleSignIn(client = client, onError = { PayCraftLogger.onError("signIn", "google: $it") })
    val appleAvailable = PlatformInfo.platform == "ios" || PayCraft.nativeAuthConfig.appleServiceId.isNotBlank()
    return remember(apple, google, appleAvailable) {
        PayCraftSignIn(
            launch = { provider ->
                when (provider) {
                    OAuthProvider.APPLE -> apple.launch()
                    OAuthProvider.GOOGLE -> google.launch()
                }
            },
            providers = if (appleAvailable) {
                setOf(
                    OAuthProvider.GOOGLE,
                    OAuthProvider.APPLE,
                )
            } else {
                setOf(OAuthProvider.GOOGLE)
            },
        )
    }
}
