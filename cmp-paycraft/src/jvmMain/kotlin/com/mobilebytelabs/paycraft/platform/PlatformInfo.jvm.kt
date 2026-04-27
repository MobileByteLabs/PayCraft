package com.mobilebytelabs.paycraft.platform

actual object PlatformInfo {
    actual val platform: String = "desktop"
    actual val deviceName: String
        get() = "${System.getProperty("os.name")} (${System.getProperty("user.name")})"
}
