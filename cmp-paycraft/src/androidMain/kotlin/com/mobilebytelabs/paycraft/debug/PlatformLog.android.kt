package com.mobilebytelabs.paycraft.debug

import android.util.Log

/**
 * Android actual — real logcat levels, so the documented `adb logcat -s "PayCraft:D" "*:S"` filter
 * keeps working. Routing through println would re-tag everything as System.out and silently break
 * that filter.
 */
actual fun platformLog(
    level: PayCraftLogLevel,
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    when (level) {
        PayCraftLogLevel.DEBUG -> if (throwable != null) Log.d(tag, message, throwable) else Log.d(tag, message)
        PayCraftLogLevel.WARN -> if (throwable != null) Log.w(tag, message, throwable) else Log.w(tag, message)
        PayCraftLogLevel.ERROR -> if (throwable != null) Log.e(tag, message, throwable) else Log.e(tag, message)
    }
}
