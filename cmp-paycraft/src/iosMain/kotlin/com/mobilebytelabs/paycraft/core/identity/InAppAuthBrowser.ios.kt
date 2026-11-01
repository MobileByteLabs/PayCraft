package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.PayCraftPlatform
import com.mobilebytelabs.paycraft.platform.PlatformInfo
import platform.AuthenticationServices.ASPresentationAnchor
import platform.AuthenticationServices.ASWebAuthenticationPresentationContextProvidingProtocol
import platform.AuthenticationServices.ASWebAuthenticationSession
import platform.AuthenticationServices.ASWebAuthenticationSessionErrorCodeCanceledLogin
import platform.Foundation.NSURL
import platform.UIKit.UIApplication
import platform.UIKit.UIWindow
import platform.darwin.NSObject
import platform.darwin.dispatch_async
import platform.darwin.dispatch_get_main_queue

/**
 * ASWebAuthenticationSession with callbackURLScheme `<bundle id>.paycraft` — the scheme the callback
 * page redirects to, intercepted by the session itself, so no Info.plist URL type is needed.
 * Completion → [BrowserReturn.Completed] (VerifiedSignIn reads `/result` at once); the user closing
 * the sheet → [BrowserReturn.Cancelled].
 */
internal actual object InAppAuthBrowser {
    /** Held for the flow's lifetime — the session keeps its presentation provider weakly. */
    private var inFlight: Pair<ASWebAuthenticationSession, AnchorProvider>? = null

    actual fun open(url: String, onReturn: (BrowserReturn) -> Unit) {
        val bundleId = PlatformInfo.appId
        val nsUrl = NSURL.URLWithString(url)
        if (bundleId.isBlank() || nsUrl == null) {
            PayCraftPlatform.openUrl(url)
            return
        }
        dispatch_async(dispatch_get_main_queue()) {
            val session = ASWebAuthenticationSession(
                uRL = nsUrl,
                callbackURLScheme = "$bundleId.paycraft",
            ) { _, error ->
                inFlight = null
                onReturn(
                    if (error?.code == ASWebAuthenticationSessionErrorCodeCanceledLogin) {
                        BrowserReturn.Cancelled
                    } else {
                        // Callback URL — or any other error, where /result tells the truth.
                        BrowserReturn.Completed
                    },
                )
            }
            val anchor = AnchorProvider()
            session.presentationContextProvider = anchor
            session.prefersEphemeralWebBrowserSession = false
            inFlight = session to anchor
            if (!session.start()) {
                inFlight = null
                onReturn(BrowserReturn.Cancelled)
            }
        }
    }
}

private class AnchorProvider :
    NSObject(),
    ASWebAuthenticationPresentationContextProvidingProtocol {
    override fun presentationAnchorForWebAuthenticationSession(
        session: ASWebAuthenticationSession,
    ): ASPresentationAnchor = UIApplication.sharedApplication.keyWindow ?: UIWindow()
}
