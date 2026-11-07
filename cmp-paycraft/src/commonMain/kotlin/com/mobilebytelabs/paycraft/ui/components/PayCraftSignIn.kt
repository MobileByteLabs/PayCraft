package com.mobilebytelabs.paycraft.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.remember
import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.core.identity.VerifiedSignIn
import com.mobilebytelabs.paycraft.core.identity.availableProviders
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.platform.PlatformInfo
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
    val signIn = remember { KoinPlatform.getKoinOrNull()?.getOrNull<VerifiedSignIn>() } ?: return null
    val suite = PayCraft.suiteConfigFlow.collectAsState().value
    val providers = remember(suite) { availableProviders(PlatformInfo.platform, suite) }
    if (providers.isEmpty()) return null
    val state = signIn.state.collectAsState().value
    return remember(signIn, providers, state) { PayCraftSignIn(signIn::launch, providers, state, signIn::reset) }
}
