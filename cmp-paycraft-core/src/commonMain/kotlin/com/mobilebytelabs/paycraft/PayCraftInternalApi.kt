package com.mobilebytelabs.paycraft

/**
 * Shared between PayCraft's own modules only (`cmp-paycraft` UI, `cmp-paycraft-web`).
 *
 * These members were `internal` while the SDK was one module; the core split (3.0) put the logic and the
 * UI in separate Gradle modules, and `internal` does not cross a module boundary. They are public on the
 * JVM/klib level but NOT public API: no compatibility guarantee, excluded from the API dumps
 * (binary-compatibility-validator `nonPublicMarkers`), and unusable without an explicit opt-in.
 */
@RequiresOptIn(
    message = "PayCraft-internal API: for PayCraft's own modules (cmp-paycraft, cmp-paycraft-web) only.",
    level = RequiresOptIn.Level.ERROR,
)
@Retention(AnnotationRetention.BINARY)
@Target(
    AnnotationTarget.CLASS,
    AnnotationTarget.FUNCTION,
    AnnotationTarget.PROPERTY,
    AnnotationTarget.CONSTRUCTOR,
    AnnotationTarget.TYPEALIAS,
)
annotation class PayCraftInternalApi
