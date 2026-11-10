package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSUserDefaults

/**
 * iOS: NSUserDefaults-backed storage for device token.
 *
 * iOS Data Protection encrypts NSUserDefaults at rest when the device is locked.
 * For stronger isolation, migrate to Keychain Services (requires cinterop testing).
 *
 * TODO(security): Migrate to Keychain for server_token storage (P1 follow-up)
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
