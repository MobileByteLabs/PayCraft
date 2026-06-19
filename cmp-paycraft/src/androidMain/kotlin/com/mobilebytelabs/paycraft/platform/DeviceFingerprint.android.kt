package com.mobilebytelabs.paycraft.platform

import android.provider.Settings
import java.security.MessageDigest

/**
 * Android: SHA-256(SSAID + "|" + packageName) truncated to 16 hex chars.
 *
 * SSAID (`Settings.Secure.ANDROID_ID`) is naturally scoped per signing key
 * on Android 8+ — uninstalling + reinstalling the SAME app yields the SAME
 * SSAID, but a different signed app on the same device gets a different
 * value. Combined with the package name in the hash input we get a stable
 * per-(device, app) fingerprint with no PII.
 *
 * The application Context comes from PayCraftInitializer's androidx-startup
 * pass — the SDK is reachable before Application.onCreate runs.
 */
actual object DeviceFingerprint {
    @Volatile private var cached: String? = null

    actual fun get(): String {
        cached?.let { return it }
        val ctx = DeviceTokenStore.applicationContext
            ?: error("PayCraft Android Context not initialized — androidx-startup should have wired it")
        @Suppress("HardwareIds")
        val ssaid = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ANDROID_ID).orEmpty()
        val packageName = ctx.packageName
        val sha = MessageDigest.getInstance("SHA-256")
            .digest("$ssaid|$packageName".encodeToByteArray())
        val hex = buildString(sha.size * 2) {
            sha.forEach { append(((it.toInt() ushr 4) and 0x0F).toString(16)); append((it.toInt() and 0x0F).toString(16)) }
        }
        val fingerprint = hex.substring(0, 16)
        cached = fingerprint
        return fingerprint
    }
}
