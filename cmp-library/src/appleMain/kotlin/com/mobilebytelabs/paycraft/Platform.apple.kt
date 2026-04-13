package com.mobilebytelabs.paycraft

import platform.Foundation.NSProcessInfo

/**
 * Apple platform implementation (iOS, macOS, tvOS, watchOS)
 */
actual fun getPlatformName(): String {
    val info = NSProcessInfo.processInfo
    return info.operatingSystemVersionString
}
