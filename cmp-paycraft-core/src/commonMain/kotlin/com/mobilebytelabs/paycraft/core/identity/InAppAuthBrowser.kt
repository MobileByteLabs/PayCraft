package com.mobilebytelabs.paycraft.core.identity

/** How a platform's in-app auth browser reported the end of the flow. */
internal enum class BrowserReturn { Completed, Cancelled }

/**
 * Opens PayCraft's hosted sign-in IN the app (PLAN-paycraft-verified-identity D2b): Android → Chrome
 * Custom Tab, iOS → ASWebAuthenticationSession, desktop/web → the external browser.
 *
 * [onReturn] fires only where the platform itself reports the end (iOS). Android comes back through the
 * callback page's intent → the app foregrounds → [VerifiedSignIn.onForeground]; desktop/web poll.
 */
internal expect object InAppAuthBrowser {
    fun open(url: String, onReturn: (BrowserReturn) -> Unit)
}
