package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSLocale
import platform.Foundation.countryCode
import platform.Foundation.currentLocale
import platform.UIKit.UIDevice

actual object PlatformInfo {
    actual val platform: String = "ios"

    // Kotlin/Native exposes how THIS binary was compiled. The framework is built alongside the app
    // in the same Xcode configuration, so a Debug-configuration app carries a debug framework.
    @OptIn(kotlin.experimental.ExperimentalNativeApi::class)
    actual val isDebugBuild: Boolean
        get() = kotlin.native.Platform.isDebugBinary

    // UIDevice.currentDevice.name is the user-assigned device name: "Rajan's iPhone"
    actual val deviceName: String
        get() = UIDevice.currentDevice.name

    actual val deviceId: String
        get() = UIDevice.currentDevice.identifierForVendor?.UUIDString ?: "ios-unknown"

    actual val country: String?
        get() = NSLocale.currentLocale.countryCode?.takeIf { it.isNotBlank() }
}
