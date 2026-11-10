package com.mobilebytelabs.paycraft.core.identity

import com.mobilebytelabs.paycraft.PayCraftPlatform

/** No in-app auth browser here: the external browser, and VerifiedSignIn's slow poll picks the result up. */
internal actual object InAppAuthBrowser {
    actual fun open(url: String, onReturn: (BrowserReturn) -> Unit) = PayCraftPlatform.openUrl(url)
}
