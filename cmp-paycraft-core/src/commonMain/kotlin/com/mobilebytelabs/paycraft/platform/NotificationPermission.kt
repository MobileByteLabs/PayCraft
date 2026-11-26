package com.mobilebytelabs.paycraft.platform

/**
 * The device's notification permission for this app. [isGranted] only READS it — the resume reminder is scheduled
 * only when it is already granted (paycraft-attempt-observability D11). [request] shows the system prompt, and runs
 * only when the app calls `PayCraft.requestNotificationPermission()`; the SDK never prompts by itself.
 */
internal expect object NotificationPermission {
    suspend fun isGranted(): Boolean

    suspend fun request(): Boolean
}
