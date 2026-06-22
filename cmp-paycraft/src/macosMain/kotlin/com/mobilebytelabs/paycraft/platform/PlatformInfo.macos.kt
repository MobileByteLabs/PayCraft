package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSHost
import platform.Foundation.NSLocale
import platform.Foundation.NSUUID
import platform.Foundation.NSUserDefaults
import platform.Foundation.countryCode
import platform.Foundation.currentLocale

actual object PlatformInfo {
    actual val platform: String = "macos"
    actual val deviceName: String
        get() = NSHost.currentHost().localizedName ?: "Mac"
    actual val deviceId: String
        get() = loadOrCreateMacDeviceId()
    actual val country: String?
        get() = NSLocale.currentLocale.countryCode?.takeIf { it.isNotBlank() }
}

private fun loadOrCreateMacDeviceId(): String {
    val key = "paycraft_device_id"
    val stored = NSUserDefaults.standardUserDefaults.stringForKey(key)
    if (stored != null) return stored
    val generated = NSUUID().UUIDString
    NSUserDefaults.standardUserDefaults.setObject(generated, key)
    return generated
}
