package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.model.OAuthProvider

/**
 * The platform's native sign-in sheet (D1): Android Google → Credential Manager, iOS Apple →
 * ASAuthorization. Every other (platform, provider) answers [NativeTokenResult.Unavailable] and
 * [VerifiedSignIn] takes the browser flow. [rawNonce] is sent raw to /verify; Apple gets its SHA-256.
 */
internal expect object NativeIdTokenProvider {
    suspend fun idToken(provider: OAuthProvider, rawNonce: String): NativeTokenResult
}
