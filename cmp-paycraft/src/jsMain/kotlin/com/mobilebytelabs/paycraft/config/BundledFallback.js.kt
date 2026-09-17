package com.mobilebytelabs.paycraft.config

/**
 * Web actual — always null, BY DESIGN.
 *
 * There is no app binary on the web to bundle a fallback into, and no synchronous resource read in
 * a browser. Layer 3 is therefore skipped on web and the chain proceeds to the built-in paywall.
 * This is a deliberate absence rather than an unimplemented stub: a web client that cannot reach
 * the network cannot fetch a same-origin asset either.
 */
actual fun readBundledSuiteConfigJsonOrNull(): String? = null
