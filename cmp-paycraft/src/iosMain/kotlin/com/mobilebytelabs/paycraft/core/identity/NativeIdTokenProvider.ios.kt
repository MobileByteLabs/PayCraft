package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.model.OAuthProvider
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.convert
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.AuthenticationServices.ASAuthorization
import platform.AuthenticationServices.ASAuthorizationAppleIDCredential
import platform.AuthenticationServices.ASAuthorizationAppleIDProvider
import platform.AuthenticationServices.ASAuthorizationController
import platform.AuthenticationServices.ASAuthorizationControllerDelegateProtocol
import platform.AuthenticationServices.ASAuthorizationControllerPresentationContextProvidingProtocol
import platform.AuthenticationServices.ASAuthorizationErrorCanceled
import platform.AuthenticationServices.ASAuthorizationScopeEmail
import platform.AuthenticationServices.ASPresentationAnchor
import platform.CoreCrypto.CC_SHA256
import platform.CoreCrypto.CC_SHA256_DIGEST_LENGTH
import platform.Foundation.NSError
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.UIKit.UIApplication
import platform.UIKit.UIWindow
import platform.darwin.NSObject
import kotlin.coroutines.resume

/** Apple via ASAuthorization (no secret needed natively). Google → browser. */
internal actual object NativeIdTokenProvider {
    /** Held for the request's lifetime — ASAuthorizationController keeps its delegate weakly. */
    private var inFlight: AppleDelegate? = null

    actual suspend fun idToken(provider: OAuthProvider, rawNonce: String): NativeTokenResult {
        if (provider != OAuthProvider.APPLE) return NativeTokenResult.Unavailable
        return suspendCancellableCoroutine { cont ->
            val request = ASAuthorizationAppleIDProvider().createRequest().apply {
                requestedScopes = listOf(ASAuthorizationScopeEmail)
                nonce = sha256Hex(rawNonce)
            }
            val delegate = AppleDelegate { result ->
                inFlight = null
                if (cont.isActive) cont.resume(result)
            }
            inFlight = delegate
            ASAuthorizationController(listOf(request)).apply {
                this.delegate = delegate
                presentationContextProvider = delegate
                performRequests()
            }
        }
    }

    @OptIn(ExperimentalForeignApi::class)
    private fun sha256Hex(input: String): String {
        val data = input.encodeToByteArray()
        val digest = UByteArray(CC_SHA256_DIGEST_LENGTH)
        data.usePinned { src ->
            digest.usePinned { dst -> CC_SHA256(src.addressOf(0), data.size.convert(), dst.addressOf(0)) }
        }
        return digest.joinToString("") { it.toString(16).padStart(2, '0') }
    }
}

private class AppleDelegate(private val done: (NativeTokenResult) -> Unit) :
    NSObject(),
    ASAuthorizationControllerDelegateProtocol,
    ASAuthorizationControllerPresentationContextProvidingProtocol {

    override fun authorizationController(
        controller: ASAuthorizationController,
        didCompleteWithAuthorization: ASAuthorization,
    ) {
        val credential = didCompleteWithAuthorization.credential as? ASAuthorizationAppleIDCredential
        val token = credential?.identityToken?.let {
            NSString.create(data = it, encoding = NSUTF8StringEncoding)?.toString()
        }
        done(
            if (token.isNullOrBlank()) NativeTokenResult.Failed("no identityToken") else NativeTokenResult.Token(token),
        )
    }

    override fun authorizationController(controller: ASAuthorizationController, didCompleteWithError: NSError) {
        done(
            if (didCompleteWithError.code == ASAuthorizationErrorCanceled) {
                NativeTokenResult.Cancelled
            } else {
                NativeTokenResult.Failed(didCompleteWithError.localizedDescription)
            },
        )
    }

    override fun presentationAnchorForAuthorizationController(
        controller: ASAuthorizationController,
    ): ASPresentationAnchor = UIApplication.sharedApplication.keyWindow ?: UIWindow()
}
