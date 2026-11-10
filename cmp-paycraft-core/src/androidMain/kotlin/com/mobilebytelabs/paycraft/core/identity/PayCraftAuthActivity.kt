package com.mobilebytelabs.paycraft.core.identity

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.browser.customtabs.CustomTabsIntent
import com.mobilebytelabs.paycraft.PayCraftPlatform

/**
 * Invisible host for the sign-in Custom Tab (D2b) — the AppAuth pattern, merged from the SDK manifest
 * so the host app declares nothing.
 *
 * Started with [EXTRA_URL]: opens the Custom Tab on top of itself. The callback page then fires
 * `intent://…;scheme=<applicationId>.paycraft;package=<applicationId>` — Chrome only launches BROWSABLE
 * activities from the web, which is why this one carries that filter. `singleTask` brings this
 * instance back and clears the Custom Tab above it; it finishes and the host screen is revealed. The
 * user closing the tab instead resumes this activity, which finishes the same way. Either way the app
 * foregrounds and VerifiedSignIn reads `/result`.
 */
class PayCraftAuthActivity : Activity() {
    private var browserOpened = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        browserOpened = savedInstanceState?.getBoolean(KEY_OPENED) ?: false
        // Launched by the callback intent with no live instance (external-browser fallback): just
        // bring the app forward.
        if (intent.getStringExtra(EXTRA_URL) == null) finish()
    }

    override fun onResume() {
        super.onResume()
        if (isFinishing) return
        if (browserOpened) {
            finish() // back from the tab — completed or closed; the foreground poll decides which
            return
        }
        browserOpened = true
        val url = intent.getStringExtra(EXTRA_URL) ?: return finish()
        try {
            CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this, Uri.parse(url))
        } catch (_: ActivityNotFoundException) {
            PayCraftPlatform.openUrl(url)
            finish()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        finish() // the callback page handed control back
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean(KEY_OPENED, browserOpened)
    }

    internal companion object {
        const val EXTRA_URL = "com.mobilebytelabs.paycraft.auth.URL"
        private const val KEY_OPENED = "browser_opened"
    }
}
