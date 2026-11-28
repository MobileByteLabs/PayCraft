package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.identity.ConsumerIdentityLink
import com.mobilebytelabs.paycraft.core.identity.ConsumerLinkFailure
import com.mobilebytelabs.paycraft.core.identity.ConsumerLinkState
import com.mobilebytelabs.paycraft.core.identity.SignInFailure
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.core.identity.VerifiedSignIn
import com.mobilebytelabs.paycraft.core.identity.availableProviders
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import com.mobilebytelabs.paycraft.ui.ConsumerSupabaseAuth
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthClient
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthError
import io.github.mobilebytelabs.supabaseauth.compose.rememberKmpSupabaseAppleSignIn
import io.github.mobilebytelabs.supabaseauth.compose.rememberKmpSupabaseGoogleSignIn
import org.koin.mp.KoinPlatform

/**
 * What the identity screens render: a launcher, which providers it can actually complete, and where
 * the attempt is ([state] — always [SignInState.Idle] for a host handler, which owns its own UI).
 */
internal class PayCraftSignIn(
    val launch: (OAuthProvider) -> Unit,
    val providers: Set<OAuthProvider>,
    val state: SignInState = SignInState.Idle,
    /** Abandons the attempt (WaitingForBrowser → Idle). A no-op for a host handler. */
    val reset: () -> Unit = {},
)

/** The provider an attempt is running for — buttons disable and the tapped one shows progress. */
internal val SignInState.busyProvider: OAuthProvider?
    get() = when (this) {
        is SignInState.Launching -> provider
        is SignInState.WaitingForBrowser -> provider
        is SignInState.Verifying -> provider
        else -> null
    }

/**
 * [VerifiedSignIn] is a singleton, so a screen can open on the previous screen's outcome (a
 * "Couldn't verify" card on a sheet the user never signed in from). Clears a TERMINAL state once,
 * on entry; an attempt still in flight is left alone.
 */
@Composable
internal fun ResetStaleSignIn(signIn: PayCraftSignIn?) {
    LaunchedEffect(Unit) {
        val s = signIn?.state
        if (s is SignInState.Linked || s is SignInState.Cancelled || s is SignInState.Failed) signIn.reset()
    }
}

/**
 * The sign-in PayCraft's identity screens (restore, device conflict, post-purchase link) use.
 *
 * The host's [LocalPayCraftOAuthHandler] wins when provided. Otherwise this is PayCraft's own
 * [VerifiedSignIn] (PLAN-paycraft-verified-identity): native token where the platform has one, the
 * server-hosted browser flow elsewhere, verified by the identity-token edge function — no Supabase user.
 * Providers follow the live suite config ([availableProviders]), so buttons appear when config lands.
 *
 * Null = nothing can sign in (no Koin graph, PayCraft unconfigured, no provider) — callers render no buttons.
 */
@Composable
internal fun rememberPayCraftSignIn(): PayCraftSignIn? {
    LocalPayCraftOAuthHandler.current?.let { host ->
        return remember(host) { PayCraftSignIn(host, OAuthProvider.entries.toSet()) }
    }
    ConsumerSupabaseAuth.client?.let { client ->
        val link = PayCraft.consumerIdentity.collectAsState().value ?: return null
        return rememberConsumerSignIn(client, link)
    }
    val signIn = remember { KoinPlatform.getKoinOrNull()?.getOrNull<VerifiedSignIn>() } ?: return null
    val suite = PayCraft.suiteConfigFlow.collectAsState().value
    val providers = remember(suite) { availableProviders(PlatformInfo.platform, suite) }
    if (providers.isEmpty()) return null
    val state = signIn.state.collectAsState().value
    return remember(signIn, providers, state) { PayCraftSignIn(signIn::launch, providers, state, signIn::reset) }
}

/**
 * Sign-in through the APP's Supabase (PLAN paycraft-consumer-supabase-identity D4): the buttons run the app's
 * kmp-supabase-auth launchers; the session that lands is linked by [ConsumerIdentityLink], whose state drives
 * the screen. A launcher error (cancelled, not configured) is shown until the next tap.
 */
@Composable
private fun rememberConsumerSignIn(client: KmpSupabaseAuthClient, link: ConsumerIdentityLink): PayCraftSignIn {
    var tapped by remember { mutableStateOf<OAuthProvider?>(null) }
    var launchError by remember { mutableStateOf<KmpSupabaseAuthError?>(null) }
    val google = rememberKmpSupabaseGoogleSignIn(client = client, onError = { launchError = it })
    val apple = rememberKmpSupabaseAppleSignIn(client = client, onError = { launchError = it })
    val linkState = link.state.collectAsState().value
    val state = consumerSignInState(tapped, launchError, linkState)
    // Keyed on the state: a cancelled / failed attempt is reported once, not on every recomposition.
    LaunchedEffect(state) { PayCraft.reportSignInFailure(state) }
    return PayCraftSignIn(
        launch = { provider ->
            tapped = provider
            launchError = null
            (if (provider == OAuthProvider.APPLE) apple else google).launch()
        },
        providers = setOf(OAuthProvider.GOOGLE, OAuthProvider.APPLE),
        state = state,
        reset = {
            tapped = null
            launchError = null
        },
    )
}

/** What the identity screens show for a consumer sign-in: nothing tapped is Idle; the link decides the rest. */
internal fun consumerSignInState(
    tapped: OAuthProvider?,
    launchError: KmpSupabaseAuthError?,
    link: ConsumerLinkState,
): SignInState {
    val provider = tapped ?: return if (link is ConsumerLinkState.Linked) {
        SignInState.Linked(link.email, OAuthProvider.GOOGLE)
    } else {
        SignInState.Idle
    }
    return launchError?.let { launcherState(provider, it) } ?: linkState(provider, link)
}

/** The launcher's own outcome wins: a cancelled sheet is "cancelled", not a spinner waiting on the link. */
private fun launcherState(provider: OAuthProvider, error: KmpSupabaseAuthError): SignInState = when (error) {
    is KmpSupabaseAuthError.Cancelled -> SignInState.Cancelled(provider)
    is KmpSupabaseAuthError.NotConfigured -> SignInState.Failed(provider, SignInFailure.NotConfigured)
    is KmpSupabaseAuthError.Network -> SignInState.Failed(provider, SignInFailure.Network)
    else -> SignInState.Failed(provider, SignInFailure.Unknown)
}

private fun linkState(provider: OAuthProvider, link: ConsumerLinkState): SignInState = when (link) {
    ConsumerLinkState.Idle -> SignInState.Launching(provider)

    ConsumerLinkState.Linking -> SignInState.Verifying(provider)

    is ConsumerLinkState.Linked -> SignInState.Linked(link.email, provider)

    is ConsumerLinkState.Failed -> SignInState.Failed(
        provider,
        when (link.reason) {
            ConsumerLinkFailure.NotConfigured -> SignInFailure.NotConfigured
            ConsumerLinkFailure.Rejected, ConsumerLinkFailure.NoEmail -> SignInFailure.Rejected
            ConsumerLinkFailure.Network -> SignInFailure.Network
            ConsumerLinkFailure.Unknown -> SignInFailure.Unknown
        },
    )
}
