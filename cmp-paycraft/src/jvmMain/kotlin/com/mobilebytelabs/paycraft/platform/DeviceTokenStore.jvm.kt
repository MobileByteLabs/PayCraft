package com.mobilebytelabs.paycraft.platform

import java.io.File
import java.util.prefs.Preferences

/**
 * JVM Desktop: Two-layer storage for redundancy.
 * Layer 1: java.util.prefs.Preferences (OS-native: Registry on Windows, plist on macOS, ~/.java on Linux)
 * Layer 2: ~/.paycraft/device_token file — fallback if Preferences fails
 *
 * Note: Neither layer survives account deletion, but this matches desktop user expectations.
 */
actual object DeviceTokenStore {
    private val prefs: Preferences by lazy { Preferences.userRoot().node("paycraft") }
    private val tokenFile: File by lazy {
        File(System.getProperty("user.home") + "/.paycraft/device_token")
    }

    actual fun getToken(): String? {
        prefs.get("device_token", null)?.let { if (it.isNotBlank()) return it }
        return if (tokenFile.exists()) tokenFile.readText().trim().ifBlank { null } else null
    }

    actual fun saveToken(token: String) {
        prefs.put("device_token", token)
        try {
            prefs.flush()
        } catch (_: Exception) {}
        try {
            tokenFile.parentFile?.mkdirs()
            tokenFile.writeText(token)
        } catch (_: Exception) {}
    }

    actual fun clearToken() {
        try {
            prefs.remove("device_token")
            prefs.flush()
        } catch (_: Exception) {}
        try {
            tokenFile.delete()
        } catch (_: Exception) {}
    }
}
