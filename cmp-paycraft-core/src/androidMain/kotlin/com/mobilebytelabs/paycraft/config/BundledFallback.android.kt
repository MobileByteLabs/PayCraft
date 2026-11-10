package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.platform.DeviceTokenStore

/**
 * Android actual — reads `assets/paycraft-fallback.json`.
 *
 * The application Context comes from PayCraftInitializer's androidx-startup wiring, the same source
 * PlatformInfo and DeviceFingerprint use. Unlike DeviceFingerprint this does NOT `error()` when the
 * context is missing: this function exists to keep a failing app usable, so it returns null on a
 * startup-ordering race and lets the chain fall through to the built-in layer.
 */
actual fun readBundledSuiteConfigJsonOrNull(): String? = runCatching {
    val ctx = DeviceTokenStore.applicationContext ?: return null
    ctx.assets.open(BUNDLED_FALLBACK_FILENAME).use { it.readBytes().decodeToString() }
}.getOrNull()
