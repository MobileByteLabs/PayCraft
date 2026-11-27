package com.mobilebytelabs.paycraft.ui.components

import com.mobilebytelabs.paycraft.core.identity.ConsumerLinkFailure
import com.mobilebytelabs.paycraft.core.identity.ConsumerLinkState
import com.mobilebytelabs.paycraft.core.identity.SignInFailure
import com.mobilebytelabs.paycraft.core.identity.SignInState
import com.mobilebytelabs.paycraft.model.OAuthProvider.APPLE
import com.mobilebytelabs.paycraft.model.OAuthProvider.GOOGLE
import io.github.mobilebytelabs.supabaseauth.KmpSupabaseAuthError
import kotlin.test.Test
import kotlin.test.assertEquals

class ConsumerSignInStateTest {

    @Test
    fun nothingTapped_isIdle_unlessAlreadyLinked() {
        assertEquals(SignInState.Idle, consumerSignInState(null, null, ConsumerLinkState.Idle))
        assertEquals(
            SignInState.Linked("a@x", GOOGLE),
            consumerSignInState(null, null, ConsumerLinkState.Linked("a@x")),
        )
    }

    @Test
    fun tapped_followsTheLink() {
        assertEquals(SignInState.Launching(APPLE), consumerSignInState(APPLE, null, ConsumerLinkState.Idle))
        assertEquals(SignInState.Verifying(APPLE), consumerSignInState(APPLE, null, ConsumerLinkState.Linking))
        assertEquals(
            SignInState.Linked("a@x", APPLE),
            consumerSignInState(APPLE, null, ConsumerLinkState.Linked("a@x")),
        )
        assertEquals(
            SignInState.Failed(GOOGLE, SignInFailure.NotConfigured),
            consumerSignInState(GOOGLE, null, ConsumerLinkState.Failed(ConsumerLinkFailure.NotConfigured)),
        )
    }

    // The launcher's own outcome wins: a cancelled sheet is "cancelled", not a spinner waiting on the link.
    @Test
    fun launcherError_winsOverTheLink() {
        assertEquals(
            SignInState.Cancelled(GOOGLE),
            consumerSignInState(GOOGLE, KmpSupabaseAuthError.Cancelled, ConsumerLinkState.Idle),
        )
        assertEquals(
            SignInState.Failed(GOOGLE, SignInFailure.NotConfigured),
            consumerSignInState(GOOGLE, KmpSupabaseAuthError.NotConfigured, ConsumerLinkState.Idle),
        )
    }
}
