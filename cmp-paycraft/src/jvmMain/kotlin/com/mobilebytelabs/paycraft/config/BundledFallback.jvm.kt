package com.mobilebytelabs.paycraft.config

/**
 * JVM/desktop actual — reads `paycraft-fallback.json` from the classpath.
 *
 * Resolves through this class's own loader rather than the thread context loader, so it still works
 * when the SDK is loaded from a shaded or module-path context whose context loader does not own the
 * resource.
 */
actual fun readBundledSuiteConfigJsonOrNull(): String? = runCatching {
    val loader = BundledFallbackJvmAnchor::class.java.classLoader ?: return null
    val stream = loader.getResourceAsStream(BUNDLED_FALLBACK_FILENAME) ?: return null
    stream.use { it.readBytes().decodeToString() }
}.getOrNull()

/** Anchor for classloader resolution — see above. */
private class BundledFallbackJvmAnchor
