package com.mobilebytelabs.paycraft

import platform.Foundation.NSURL
import platform.UIKit.UIApplication

actual object PayCraftPlatform {
    actual fun openUrl(url: String) {
        val nsUrl = NSURL.URLWithString(url) ?: return
        UIApplication.sharedApplication.openURL(nsUrl)
    }
}
