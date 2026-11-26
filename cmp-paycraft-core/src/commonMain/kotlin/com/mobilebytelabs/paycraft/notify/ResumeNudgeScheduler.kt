package com.mobilebytelabs.paycraft.notify

/**
 * Posts ONE local "resume your purchase" notification after a checkout abandon or payment failure
 * (paycraft-attempt-observability D10–D12): Android through one-time unique WorkManager work, iOS through
 * `UNUserNotificationCenter`; desktop and web have no reminder ([isSupported] false) and do nothing.
 *
 * WHETHER to remind is decided once, in common code ([ResumeNudgeEligibility]); this class only schedules, cancels
 * and asks. It never prompts for permission on its own — [requestPermission] runs only when the app calls
 * `PayCraft.requestNotificationPermission()` at a moment it chooses (D11). Tapping the notification opens the app and
 * raises the SDK's paywall through `PayCraft.paywallPresentation` (RULE-PAYCRAFT-SINGLE-SURFACE-001).
 */
internal expect class ResumeNudgeScheduler() {
    /** False where the platform has no local notifications, or the SDK has no application context yet. */
    val isSupported: Boolean

    /** Schedules the reminder for [attemptId] after [NudgeConfig.delayMs], replacing one already scheduled for it. */
    suspend fun schedule(attemptId: String, config: NudgeConfig)

    /** Cancels the reminder for [attemptId], scheduled or already shown. */
    suspend fun cancel(attemptId: String)

    /** Cancels every PayCraft reminder (premium arrived) — never the host app's own notifications. */
    suspend fun cancelAll()

    /** Asks the user for notification permission; true when it is granted afterwards. */
    suspend fun requestPermission(): Boolean
}

/** The notification identifier a reminder is posted under, and the way back from it to its attempt. */
internal object ResumeNudgeIds {
    const val PREFIX: String = "paycraft.resume."

    fun identifier(attemptId: String): String = PREFIX + attemptId

    fun attemptIdOf(identifier: String): String? =
        identifier.takeIf { it.startsWith(PREFIX) }?.removePrefix(PREFIX)?.takeIf { it.isNotBlank() }
}
