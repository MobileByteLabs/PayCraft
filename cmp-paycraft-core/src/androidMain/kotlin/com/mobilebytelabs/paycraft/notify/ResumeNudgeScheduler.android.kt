package com.mobilebytelabs.paycraft.notify

import android.content.Context
import androidx.core.app.NotificationManagerCompat
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import com.mobilebytelabs.paycraft.PayCraftPlatform
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.notify.internal.ResumeNudgeWorker
import com.mobilebytelabs.paycraft.platform.NotificationPermission
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

/**
 * Android: one-time UNIQUE WorkManager work per attempt, so the reminder survives the app being killed and the
 * device rebooting, and scheduling it twice for one attempt replaces rather than duplicates it. The worker posts
 * the notification on the `paycraft_resume` channel ([ResumeNudgeWorker]).
 *
 * WorkManager is the app's: the SDK uses `WorkManager.getInstance(context)`, which honours a host that configures
 * WorkManager itself (a `Configuration.Provider` Application). A host that disabled initialization without
 * initializing it gets no reminder and a logged error — never a crash in the purchase path.
 */
internal actual class ResumeNudgeScheduler actual constructor() {
    private val context: Context? get() = PayCraftPlatform.applicationContextOrNull()

    actual val isSupported: Boolean get() = context != null

    actual suspend fun schedule(attemptId: String, config: NudgeConfig) {
        val ctx = context ?: return
        if (!config.enabled) return
        withContext(Dispatchers.IO) {
            val input = Data.Builder()
                .putString(ResumeNudgeWorker.KEY_ATTEMPT_ID, attemptId)
                .putString(ResumeNudgeWorker.KEY_TITLE, config.title)
                .putString(ResumeNudgeWorker.KEY_BODY, config.body)
                .build()
            val request = OneTimeWorkRequestBuilder<ResumeNudgeWorker>()
                .setInitialDelay(config.delayMs, TimeUnit.MILLISECONDS)
                .setInputData(input)
                .addTag(WORK_TAG)
                .build()
            runCatching {
                WorkManager.getInstance(
                    ctx,
                ).enqueueUniqueWork(uniqueName(attemptId), ExistingWorkPolicy.REPLACE, request)
            }.onFailure { PayCraftLogger.onError("ResumeNudgeScheduler.schedule", it.message) }
        }
    }

    actual suspend fun cancel(attemptId: String) {
        val ctx = context ?: return
        withContext(Dispatchers.IO) {
            runCatching { WorkManager.getInstance(ctx).cancelUniqueWork(uniqueName(attemptId)) }
                .onFailure { PayCraftLogger.onError("ResumeNudgeScheduler.cancel", it.message) }
            NotificationManagerCompat.from(
                ctx,
            ).cancel(ResumeNudgeIds.identifier(attemptId), ResumeNudgeWorker.NOTIFICATION_ID)
        }
    }

    actual suspend fun cancelAll() {
        val ctx = context ?: return
        withContext(Dispatchers.IO) {
            runCatching { WorkManager.getInstance(ctx).cancelAllWorkByTag(WORK_TAG) }
                .onFailure { PayCraftLogger.onError("ResumeNudgeScheduler.cancelAll", it.message) }
            // Only PayCraft's own posted reminder — the host's notifications are untouched.
            val manager = NotificationManagerCompat.from(ctx)
            manager.activeNotifications
                .filter {
                    it.id == ResumeNudgeWorker.NOTIFICATION_ID &&
                        it.tag?.startsWith(ResumeNudgeIds.PREFIX) == true
                }
                .forEach { manager.cancel(it.tag, it.id) }
        }
    }

    actual suspend fun requestPermission(): Boolean = NotificationPermission.request()

    private companion object {
        const val WORK_TAG = "paycraft.resume"

        fun uniqueName(attemptId: String) = ResumeNudgeIds.identifier(attemptId)
    }
}
