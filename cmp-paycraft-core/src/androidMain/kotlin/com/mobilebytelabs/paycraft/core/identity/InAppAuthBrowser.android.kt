package com.mobilebytelabs.paycraft.core.identity

import android.content.Intent
import androidx.browser.customtabs.CustomTabsClient
import com.mobilebytelabs.paycraft.PayCraftPlatform

/**
 * A Chrome Custom Tab hosted by [PayCraftAuthActivity], which also receives the callback page's intent
 * and closes the tab. The app then foregrounds and [VerifiedSignIn.onForeground] reads `/result`.
 * No Custom Tabs provider on the device → the external browser (the return intent still lands).
 */
internal actual object InAppAuthBrowser {
    actual fun open(url: String, onReturn: (BrowserReturn) -> Unit) {
        val activity = PayCraftPlatform.currentActivityOrNull()
        val context = activity ?: PayCraftPlatform.applicationContextOrNull()
        if (context == null || CustomTabsClient.getPackageName(context, null) == null) {
            PayCraftPlatform.openUrl(url)
            return
        }
        val intent = Intent(context, PayCraftAuthActivity::class.java).putExtra(PayCraftAuthActivity.EXTRA_URL, url)
        if (activity == null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
