package com.mobilebytelabs.paycraft.config

/**
 * Layer 3 of the resilience chain: a fallback `SuiteConfig` JSON shipped inside the app binary.
 *
 * Deliberately `expect`/`actual` rather than a commonMain resource read. Each platform locates
 * bundled assets differently (Android assets, an iOS main-bundle file, a JVM classpath resource),
 * and on web there is no app binary to bundle into at all — so the web actual returns null and the
 * chain simply moves to the next layer. Forcing a single commonMain implementation would mean
 * inventing a lowest common denominator that is wrong everywhere.
 *
 * Returns the raw JSON string, NOT a parsed SuiteConfig: parsing lives in one place in
 * [PayCraft], so a malformed bundled file fails the same way a malformed network response does.
 *
 * MUST NOT throw. A missing or unreadable fallback is an expected condition — most apps will ship
 * without one — and an exception here would take out the very path that exists to prevent failure.
 */
expect fun readBundledSuiteConfigJsonOrNull(): String?

/** The filename every platform looks for, so an integrator has one name to learn. */
const val BUNDLED_FALLBACK_FILENAME: String = "paycraft-fallback.json"
