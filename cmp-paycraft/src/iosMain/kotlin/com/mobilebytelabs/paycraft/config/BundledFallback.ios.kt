package com.mobilebytelabs.paycraft.config

import platform.Foundation.NSBundle
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.stringWithContentsOfFile

/**
 * iOS actual — reads `paycraft-fallback.json` from the main bundle.
 *
 * The file must be in the app target's "Copy Bundle Resources" phase. When it is absent this
 * returns null and the chain moves on, which is the common case for apps shipping without a
 * fallback.
 */
// stringWithContentsOfFile takes an NSError** out-parameter, which is a CPointer — cinterop's
// ExperimentalForeignApi. The opt-in is required at the call site; without it this file does not
// compile at all, and nothing compiled it until the iOS publication ran.
@OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
actual fun readBundledSuiteConfigJsonOrNull(): String? = runCatching {
    val path = NSBundle.mainBundle.pathForResource(
        BUNDLED_FALLBACK_FILENAME.removeSuffix(".json"),
        "json",
    ) ?: return null
    @Suppress("CAST_NEVER_SUCCEEDS")
    NSString.stringWithContentsOfFile(path, NSUTF8StringEncoding, null) as String?
}.getOrNull()
