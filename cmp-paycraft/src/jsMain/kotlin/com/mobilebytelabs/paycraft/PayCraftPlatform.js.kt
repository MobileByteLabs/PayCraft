package com.mobilebytelabs.paycraft

import kotlinx.browser.window

actual object PayCraftPlatform {
    actual fun openUrl(url: String) {
        window.open(url, "_blank")
    }
}
