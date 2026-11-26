package com.mobilebytelabs.paycraft.notify

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.platform.NotificationPermission
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.Foundation.NSBundle
import platform.UserNotifications.UNMutableNotificationContent
import platform.UserNotifications.UNNotification
import platform.UserNotifications.UNNotificationRequest
import platform.UserNotifications.UNNotificationResponse
import platform.UserNotifications.UNNotificationSound
import platform.UserNotifications.UNTimeIntervalNotificationTrigger
import platform.UserNotifications.UNUserNotificationCenter
import platform.UserNotifications.UNUserNotificationCenterDelegateProtocol
import platform.darwin.NSObject
import kotlin.coroutines.resume

/**
 * iOS: a `UNTimeIntervalNotificationTrigger` request per attempt, identified `paycraft.resume.<attempt>` so
 * scheduling again for the same attempt replaces it and [cancelAll] removes only PayCraft's — never the host's.
 *
 * A tap reaches the SDK through `UNUserNotificationCenter`'s delegate. PayCraft installs its own ONLY when the app
 * has none; an app with its own delegate forwards the tap with `PayCraft.onNotificationOpened(identifier)`.
 */
internal actual class ResumeNudgeScheduler actual constructor() {
    // UNUserNotificationCenter raises an Objective-C exception (uncatchable from Kotlin) in a process without a
    // bundle — a test runner or command-line host. Every real app has a bundle identifier.
    actual val isSupported: Boolean = NSBundle.mainBundle.bundleIdentifier != null

    private val center: UNUserNotificationCenter get() = UNUserNotificationCenter.currentNotificationCenter()

    actual suspend fun schedule(attemptId: String, config: NudgeConfig) {
        if (!config.enabled) return
        if (center.delegate == null) center.delegate = nudgeTapDelegate
        val content = UNMutableNotificationContent().apply {
            setTitle(config.title)
            setBody(config.body)
            setSound(UNNotificationSound.defaultSound)
        }
        val trigger = UNTimeIntervalNotificationTrigger.triggerWithTimeInterval(
            timeInterval = config.delayMs / 1_000.0,
            repeats = false,
        )
        val request = UNNotificationRequest.requestWithIdentifier(
            identifier = ResumeNudgeIds.identifier(attemptId),
            content = content,
            trigger = trigger,
        )
        suspendCancellableCoroutine { cont -> center.addNotificationRequest(request) { _ -> cont.resume(Unit) } }
    }

    actual suspend fun cancel(attemptId: String) {
        val ids = listOf(ResumeNudgeIds.identifier(attemptId))
        center.removePendingNotificationRequestsWithIdentifiers(ids)
        center.removeDeliveredNotificationsWithIdentifiers(ids)
    }

    actual suspend fun cancelAll() {
        val pending = suspendCancellableCoroutine { cont ->
            center.getPendingNotificationRequestsWithCompletionHandler { requests ->
                cont.resume(requests.orEmpty().mapNotNull { (it as? UNNotificationRequest)?.identifier })
            }
        }
        val delivered = suspendCancellableCoroutine { cont ->
            center.getDeliveredNotificationsWithCompletionHandler { notifications ->
                cont.resume(notifications.orEmpty().mapNotNull { (it as? UNNotification)?.request?.identifier })
            }
        }
        center.removePendingNotificationRequestsWithIdentifiers(pending.filter { it.startsWith(ResumeNudgeIds.PREFIX) })
        center.removeDeliveredNotificationsWithIdentifiers(delivered.filter { it.startsWith(ResumeNudgeIds.PREFIX) })
    }

    actual suspend fun requestPermission(): Boolean = NotificationPermission.request()
}

/** Routes a tap on a PayCraft reminder to the SDK. */
// Kotlin/Native cannot make an `object` an Objective-C subclass, so this is a class with one instance.
// UNUserNotificationCenter holds its delegate WEAKLY: the top-level val below is the strong reference that
// keeps tap handling alive for the process lifetime.
private class NudgeTapDelegate :
    NSObject(),
    UNUserNotificationCenterDelegateProtocol {
    override fun userNotificationCenter(
        center: UNUserNotificationCenter,
        didReceiveNotificationResponse: UNNotificationResponse,
        withCompletionHandler: () -> Unit,
    ) {
        PayCraft.onNotificationOpened(didReceiveNotificationResponse.notification.request.identifier)
        withCompletionHandler()
    }
}

private val nudgeTapDelegate = NudgeTapDelegate()
