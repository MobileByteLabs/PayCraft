package com.mobilebytelabs.paycraft.notify

/** No resume reminder on this platform: desktop (JVM) has no OS reminder surface the SDK posts to (paycraft-attempt-observability D12). */
internal actual class ResumeNudgeScheduler actual constructor() {
    actual val isSupported: Boolean = false

    // intentional-noop: desktop (JVM) has no OS reminder surface the SDK posts to; PayCraft never calls it when isSupported is false.
    actual suspend fun schedule(attemptId: String, config: NudgeConfig) = Unit

    // intentional-noop: nothing is ever scheduled on this platform, so there is nothing to cancel.
    actual suspend fun cancel(attemptId: String) = Unit

    // intentional-noop: nothing is ever scheduled on this platform, so there is nothing to cancel.
    actual suspend fun cancelAll() = Unit

    actual suspend fun requestPermission(): Boolean = false
}
