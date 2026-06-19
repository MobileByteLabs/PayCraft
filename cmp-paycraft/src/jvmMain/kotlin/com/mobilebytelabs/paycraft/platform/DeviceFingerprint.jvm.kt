package com.mobilebytelabs.paycraft.platform

import java.io.File
import java.security.MessageDigest
import java.util.UUID

/**
 * JVM/Desktop: random UUID generated once, persisted under the user's home
 * dir at `~/.paycraft/device.id` so subsequent launches return the same
 * value. Hashed with SHA-256 and truncated to 16 hex chars to keep the
 * shape consistent with mobile platforms.
 */
actual object DeviceFingerprint {
    @Volatile private var cached: String? = null

    actual fun get(): String {
        cached?.let { return it }
        val home = System.getProperty("user.home") ?: "."
        val dir = File(home, ".paycraft").apply { mkdirs() }
        val file = File(dir, "device.id")
        val raw = if (file.exists()) {
            file.readText().trim().ifBlank { UUID.randomUUID().toString().also { file.writeText(it) } }
        } else {
            UUID.randomUUID().toString().also { file.writeText(it) }
        }
        val sha = MessageDigest.getInstance("SHA-256").digest(raw.encodeToByteArray())
        val hex = buildString(sha.size * 2) {
            sha.forEach { append(((it.toInt() ushr 4) and 0x0F).toString(16)); append((it.toInt() and 0x0F).toString(16)) }
        }
        val fingerprint = hex.substring(0, 16)
        cached = fingerprint
        return fingerprint
    }
}
