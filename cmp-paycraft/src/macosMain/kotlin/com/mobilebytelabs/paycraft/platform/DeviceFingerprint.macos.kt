package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSUUID
import platform.Foundation.NSUserDefaults

/**
 * macOS: random UUID generated once and persisted in NSUserDefaults under
 * the SDK's namespace so subsequent launches return the same value.
 */
actual object DeviceFingerprint {
    private const val KEY = "paycraft_device_fingerprint"
    private var cached: String? = null

    actual fun get(): String {
        cached?.let { return it }
        val prefs = NSUserDefaults.standardUserDefaults
        val existing = prefs.stringForKey(KEY)
        val raw = if (!existing.isNullOrBlank()) {
            existing
        } else {
            val fresh = NSUUID().UUIDString
            prefs.setObject(fresh, KEY)
            prefs.synchronize()
            fresh
        }
        // Truncate to 16 hex chars (strip dashes, uppercase → lowercase).
        val hex = raw.replace("-", "").lowercase().substring(0, 16)
        cached = hex
        return hex
    }
}
