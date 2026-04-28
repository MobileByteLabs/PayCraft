package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSUserDefaults

/**
 * iOS: NSUserDefaults-backed storage for device token.
 * Survives app launches; use Keychain if stronger isolation needed.
 */
actual object DeviceTokenStore {
    private const val KEY = "paycraft_device_token"
    private val prefs = NSUserDefaults.standardUserDefaults

    actual fun getToken(): String? = prefs.stringForKey(KEY)

    actual fun saveToken(token: String) {
        prefs.setObject(token, KEY)
        prefs.synchronize()
    }

    actual fun clearToken() {
        prefs.removeObjectForKey(KEY)
        prefs.synchronize()
    }
}
