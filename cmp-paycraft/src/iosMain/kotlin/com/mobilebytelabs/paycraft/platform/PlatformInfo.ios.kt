package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSLocale
import platform.Foundation.countryCode
import platform.Foundation.currentLocale
import platform.UIKit.UIDevice

actual object PlatformInfo {
    actual val platform: String = "ios"

    // UIDevice.currentDevice.name is the user-assigned device name: "Rajan's iPhone"
    actual val deviceName: String
        get() = UIDevice.currentDevice.name

    actual val deviceId: String
        get() = UIDevice.currentDevice.identifierForVendor?.UUIDString ?: "ios-unknown"

    actual val country: String?
        get() = NSLocale.currentLocale.countryCode?.takeIf { it.isNotBlank() }
}
