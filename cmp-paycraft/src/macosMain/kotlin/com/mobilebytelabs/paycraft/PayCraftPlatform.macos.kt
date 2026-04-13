package com.mobilebytelabs.paycraft

import platform.AppKit.NSWorkspace
import platform.Foundation.NSURL

actual object PayCraftPlatform {
    actual fun openUrl(url: String) {
        val nsUrl = NSURL.URLWithString(url) ?: return
        NSWorkspace.sharedWorkspace.openURL(nsUrl)
    }
}
