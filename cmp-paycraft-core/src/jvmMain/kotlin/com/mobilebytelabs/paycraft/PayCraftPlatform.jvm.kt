package com.mobilebytelabs.paycraft

import java.awt.Desktop
import java.net.URI

actual object PayCraftPlatform {
    actual fun openUrl(url: String) {
        if (Desktop.isDesktopSupported()) {
            Desktop.getDesktop().browse(URI(url))
        }
    }
}
