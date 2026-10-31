package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.model.OAuthProvider

/** No native sign-in sheet here — both providers use the browser flow. */
internal actual object NativeIdTokenProvider {
    actual suspend fun idToken(provider: OAuthProvider, rawNonce: String): NativeTokenResult =
        NativeTokenResult.Unavailable
}
