package com.mobilebytelabs.paycraft.platform

import platform.Foundation.NSBundle
import platform.Foundation.NSUUID
import platform.UIKit.UIDevice

/**
 * iOS: identifierForVendor + bundle identifier, plain-hashed to a 16-hex
 * fingerprint using Kotlin's stdlib only (no cinterop).
 *
 * `UIDevice.current.identifierForVendor` is stable across launches and per
 * vendor (apps sharing the same Team ID see the same value on a device).
 * Combined with the bundle identifier we get a per-(device, app) fingerprint
 * with no PII.
 *
 * The hash uses a simple multiplicative scheme rather than CoreCrypto's
 * SHA-256 so the file doesn't depend on cinterop (which complicates the
 * iOS build matrix for this SDK module). Collision risk at 16 hex / 64-bit
 * is negligible given the per-vendor scope.
 */
actual object DeviceFingerprint {
    private var cached: String? = null

    actual fun get(): String {
        cached?.let { return it }
        val vendorId = UIDevice.currentDevice.identifierForVendor?.UUIDString
            ?: NSUUID().UUIDString
        val bundleId = NSBundle.mainBundle.bundleIdentifier ?: "unknown"
        val fingerprint = hash16("$vendorId|$bundleId")
        cached = fingerprint
        return fingerprint
    }

    /** FNV-1a 64-bit (Kotlin stdlib only) → 16-char lowercase hex. */
    private fun hash16(input: String): String {
        var h = 0xcbf29ce484222325uL
        val prime = 0x100000001b3uL
        for (b in input.encodeToByteArray()) {
            h = h xor (b.toLong() and 0xFFL).toULong()
            h *= prime
        }
        return h.toString(16).padStart(16, '0').takeLast(16)
    }
}
