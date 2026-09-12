package com.mobilebytelabs.paycraft.config

/**
 * Wasm/JS actual — always null, for the same reason as the JS actual: no app binary to bundle into
 * and no synchronous resource read in a browser. Layer 3 is skipped; the chain proceeds.
 */
actual fun readBundledSuiteConfigJsonOrNull(): String? = null
