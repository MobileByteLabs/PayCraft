package com.mobilebytelabs.paycraft.debug

/** Severity for [platformLog]. Mirrors the three levels PayCraft actually emits. */
enum class PayCraftLogLevel { DEBUG, WARN, ERROR }

/**
 * The SDK's one logging sink.
 *
 * PayCraft previously depended on Kermit purely to reach `Logger.d/w/e` — while ALSO owning
 * [PayCraftLogger], its own logging layer with its own tag and enable flag. Two loggers for one
 * job, and the redundant one was a published transitive dependency: PayCraft's Kermit 2.1.0 against
 * a consumer's 2.0.8 crashed reels-downloader at launch on `Logger$Companion.d$default`, and
 * holding PayCraft at the consumer's 2.0.5 broke PayCraft's own logger with overload ambiguity.
 *
 * A dependency the SDK does not need cannot skew against a consumer, so the fix is to drop it
 * rather than pin around it. This keeps [PayCraftLogger]'s API and its Android tag filter
 * (`adb logcat -s "PayCraft:D"`) exactly as documented.
 */
expect fun platformLog(
    level: PayCraftLogLevel,
    tag: String,
    message: String,
    throwable: Throwable? = null,
)
