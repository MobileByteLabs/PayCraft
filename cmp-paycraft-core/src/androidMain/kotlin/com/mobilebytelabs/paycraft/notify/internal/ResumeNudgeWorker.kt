package com.mobilebytelabs.paycraft.notify.internal

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.notify.NudgeConfig
import com.mobilebytelabs.paycraft.notify.ResumeNudgeIds

/**
 * Posts the resume reminder when its delay has passed.
 *
 * ```
 * ┌─ Notification ─────────────────────────────────────────┐
 * │ [reminder icon]  Still thinking it over?               │  ← /config.nudge.title (or this default)
 * │ Pick up where you left off.                            │  ← /config.nudge.body  (or this default)
 * └────────────────────────────────────────────────────────┘
 * ```
 * Channel `paycraft_resume` ("Payment reminders", default importance). Tapping it opens [PayCraftNudgeActivity],
 * which records the open and brings the app forward with the SDK paywall raised. If notifications were turned off
 * since it was scheduled, nothing is posted.
 */
internal class ResumeNudgeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    @SuppressLint("MissingPermission") // areNotificationsEnabled() is checked first; notify() is guarded below too.
    override suspend fun doWork(): Result {
        val attemptId = inputData.getString(KEY_ATTEMPT_ID)?.takeIf { it.isNotBlank() } ?: return Result.success()
        val title = inputData.getString(KEY_TITLE)?.takeIf { it.isNotBlank() } ?: NudgeConfig.DEFAULT_TITLE
        val body = inputData.getString(KEY_BODY)?.takeIf { it.isNotBlank() } ?: NudgeConfig.DEFAULT_BODY
        val context = applicationContext
        val manager = NotificationManagerCompat.from(context)
        if (!manager.areNotificationsEnabled()) return Result.success()

        manager.createNotificationChannel(
            NotificationChannelCompat.Builder(CHANNEL_ID, NotificationManagerCompat.IMPORTANCE_DEFAULT)
                .setName(CHANNEL_NAME)
                .build(),
        )
        val open = Intent(context, PayCraftNudgeActivity::class.java)
            .putExtra(PayCraftNudgeActivity.EXTRA_ATTEMPT_ID, attemptId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val contentIntent = PendingIntent.getActivity(
            context,
            attemptId.hashCode(),
            open,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(contentIntent)
            .setAutoCancel(true)
            .build()
        try {
            manager.notify(ResumeNudgeIds.identifier(attemptId), NOTIFICATION_ID, notification)
        } catch (e: SecurityException) {
            // Permission revoked between the check and the post — nothing to show, nothing to retry.
            PayCraftLogger.onError("ResumeNudgeWorker", e.message)
        }
        return Result.success()
    }

    internal companion object {
        const val KEY_ATTEMPT_ID = "attempt_id"
        const val KEY_TITLE = "title"
        const val KEY_BODY = "body"
        const val CHANNEL_ID = "paycraft_resume"
        const val CHANNEL_NAME = "Payment reminders"

        /** One reminder at a time per device; the tag (the attempt) tells them apart. */
        const val NOTIFICATION_ID = 0x7C_4F
    }
}
