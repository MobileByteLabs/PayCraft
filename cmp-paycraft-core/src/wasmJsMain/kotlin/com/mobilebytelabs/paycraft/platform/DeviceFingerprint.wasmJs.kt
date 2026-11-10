package com.mobilebytelabs.paycraft.platform

@JsFun("() => localStorage.getItem('paycraft_device_fingerprint')")
external fun getWasmFingerprint(): String?

@JsFun("(v) => localStorage.setItem('paycraft_device_fingerprint', v)")
external fun saveWasmFingerprint(v: String)

@JsFun("() => crypto.randomUUID()")
external fun wasmRandomUuid(): String

/**
 * WASM JS: random UUID generated once, persisted in localStorage so the same
 * value is returned on subsequent loads of the same origin. Truncated to
 * 16 hex chars to keep the shape consistent with mobile platforms.
 */
actual object DeviceFingerprint {
    actual fun get(): String {
        val existing = getWasmFingerprint()
        val raw = if (!existing.isNullOrBlank()) existing else wasmRandomUuid().also { saveWasmFingerprint(it) }
        return raw.replace("-", "").lowercase().substring(0, 16)
    }
}
