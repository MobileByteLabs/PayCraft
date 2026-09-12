package com.mobilebytelabs.paycraft.debug

/**
 * js actual — println to the platform console. There is no level-aware system logger here that
 * is worth a dependency, so the level is carried in the line prefix and stays greppable.
 */
actual fun platformLog(
    level: PayCraftLogLevel,
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    val prefix = when (level) {
        PayCraftLogLevel.DEBUG -> "D"
        PayCraftLogLevel.WARN -> "W"
        PayCraftLogLevel.ERROR -> "E"
    }
    println("$prefix/$tag: $message")
    throwable?.let { println("$prefix/$tag: ${it.stackTraceToString()}") }
}
