package com.mobilebytelabs.paycraft.platform

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationManagerCompat
import com.mobilebytelabs.paycraft.PayCraftPlatform
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull

internal actual object NotificationPermission {
    /** Notifications on for this app — the runtime grant on Android 13+, the app's notification switch before. */
    actual suspend fun isGranted(): Boolean {
        val context = PayCraftPlatform.applicationContextOrNull() ?: return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    /**
     * Shows Android 13's POST_NOTIFICATIONS prompt from the foreground Activity (waiting up to 30 s for one, so an
     * app-start hook can call it) and answers once the user has chosen. Before Android 13 there is no prompt — notifications are on unless the user turned them off in
     * Settings, which no app can do for them — so the answer is the current state. The host app must declare
     * `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`; without it the system refuses at
     * once and this returns false.
     */
    actual suspend fun request(): Boolean {
        if (isGranted()) return true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return false
        // Called from an app-start hook, no Activity exists yet: wait for the first one to come to the foreground.
        val activity = PayCraftPlatform.currentActivityOrNull()
            ?: withTimeoutOrNull(ACTIVITY_WAIT_MS) { PayCraftPlatform.activityResumes.first() }
                ?.let { PayCraftPlatform.currentActivityOrNull() }
            ?: return false
        if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return isGranted()
        }
        return coroutineScope {
            // Subscribe BEFORE asking: the dialog pauses the Activity and the user's answer resumes it.
            val paused = async(start = CoroutineStart.UNDISPATCHED) { PayCraftPlatform.activityPauses.first() }
            activity.runOnUiThread {
                activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_CODE)
            }
            // A permanently denied permission shows no dialog, so nothing pauses: answer with the current state.
            if (withTimeoutOrNull(DIALOG_APPEAR_MS) { paused.await() } == null) {
                paused.cancel()
                return@coroutineScope isGranted()
            }
            withTimeoutOrNull(USER_CHOICE_MS) { PayCraftPlatform.activityResumes.first() }
            isGranted()
        }
    }

    /** Arbitrary but unique-looking, so a host's own onRequestPermissionsResult can tell PayCraft's request apart. */
    private const val REQUEST_CODE = 0x7C_4E
    private const val ACTIVITY_WAIT_MS = 30_000L
    private const val DIALOG_APPEAR_MS = 2_000L
    private const val USER_CHOICE_MS = 5L * 60_000L
}
