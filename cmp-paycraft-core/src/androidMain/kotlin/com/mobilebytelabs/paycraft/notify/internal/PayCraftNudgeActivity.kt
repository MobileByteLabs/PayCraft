package com.mobilebytelabs.paycraft.notify.internal

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.mobilebytelabs.paycraft.PayCraft

/**
 * The resume reminder's tap target. Records the open, raises the SDK paywall through `PayCraft.paywallPresentation`
 * (the host renders it exactly as for any other request — RULE-PAYCRAFT-SINGLE-SURFACE-001), then brings the app's
 * own launcher task forward and finishes. It has no UI of its own.
 *
 * An Activity, not a receiver: Android 12+ forbids notification trampolines through BroadcastReceivers or Services,
 * and launching the host's launcher Activity directly could not tell a reminder tap from a normal launch when that
 * Activity is single-task (the extras would go to an `onNewIntent` the SDK cannot see).
 */
internal class PayCraftNudgeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent?.getStringExtra(EXTRA_ATTEMPT_ID)?.takeIf { it.isNotBlank() }?.let(PayCraft::onNudgeOpened)
        packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
            startActivity(launch)
        }
        finish()
    }

    internal companion object {
        const val EXTRA_ATTEMPT_ID = "paycraft.attempt_id"
    }
}
