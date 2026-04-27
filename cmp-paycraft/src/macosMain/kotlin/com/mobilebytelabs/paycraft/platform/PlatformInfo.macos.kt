package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSHost

actual object PlatformInfo {
    actual val platform: String = "macos"
    actual val deviceName: String
        get() = NSHost.currentHost().localizedName ?: "Mac"
}
