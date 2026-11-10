package com.mobilebytelabs.paycraft.platform

/**
 * Securely stores the server-issued device token on each platform.
 *
 * - Returns null if no token has been stored yet (first launch or storage cleared).
 * - The client never generates an identity — it stores only what the server gave it.
 * - Storage mechanism is platform-specific (Keychain, EncryptedSharedPrefs, etc.).
 */
expect object DeviceTokenStore {
    fun getToken(): String?
    fun saveToken(token: String)
    fun clearToken()
}
