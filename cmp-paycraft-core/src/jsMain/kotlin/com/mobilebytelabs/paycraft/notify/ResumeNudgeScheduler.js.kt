package com.mobilebytelabs.paycraft.notify

/** No resume reminder on this platform: a web page has no reminder surface that outlives it (paycraft-attempt-observability D12). */
internal actual class ResumeNudgeScheduler actual constructor() {
    actual val isSupported: Boolean = false

    // intentional-noop: a web page has no reminder surface that outlives it; PayCraft never calls it when isSupported is false.
    actual suspend fun schedule(attemptId: String, config: NudgeConfig) = Unit

    // intentional-noop: nothing is ever scheduled on this platform, so there is nothing to cancel.
    actual suspend fun cancel(attemptId: String) = Unit

    // intentional-noop: nothing is ever scheduled on this platform, so there is nothing to cancel.
    actual suspend fun cancelAll() = Unit

    actual suspend fun requestPermission(): Boolean = false
}
