package com.mobilebytelabs.paycraft.platform

import android.os.Build
import android.provider.Settings

actual object PlatformInfo {
    actual val platform: String = "android"
    actual val deviceName: String
        get() = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}"
    actual val deviceId: String
        get() = DeviceTokenStore.applicationContext?.let { ctx ->
            Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID)
        } ?: "android-unknown"
}
