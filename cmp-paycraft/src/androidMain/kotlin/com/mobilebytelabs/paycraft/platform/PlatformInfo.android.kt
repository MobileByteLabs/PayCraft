package com.mobilebytelabs.paycraft.platform

import android.os.Build

actual object PlatformInfo {
    actual val platform: String = "android"
    actual val deviceName: String
        get() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
}
