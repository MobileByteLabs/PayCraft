package com.mobilebytelabs.paycraft

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import co.touchlab.kermit.Logger
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import com.russhwolf.settings.Settings
import com.russhwolf.settings.SharedPreferencesSettings
import java.lang.ref.WeakReference

actual object PayCraftPlatform {
    private var appContext: android.content.Context? = null

    @Volatile
    private var currentActivityRef: WeakReference<Activity>? = null

    fun init(context: android.content.Context) {
        appContext = context.applicationContext
        DeviceTokenStore.init(context.applicationContext)
    }

    /**
     * The captured Application context, or null if [init] never ran (startup
     * Initializer disabled and no manual handoff). Used by the auto-wired
     * default native billing client so a commonMain-only consumer gets real
     * Google Play Billing with no androidMain wiring.
     */
    internal fun applicationContextOrNull(): android.content.Context? = appContext

    /** The current foreground [Activity] (or null), tracked via [startActivityTracking]. */
    internal fun currentActivityOrNull(): Activity? = currentActivityRef?.get()

    /**
     * Register foreground-Activity tracking on [app] so `launchBillingFlow` can
     * resolve the resumed Activity WITHOUT the consumer supplying an
     * activityProvider. Called once by [PayCraftInitializer] at app start;
     * idempotent-safe (a second registration just adds a second callback that
     * writes the same ref). Uses a WeakReference so a finished Activity is not
     * leaked.
     */
    internal fun startActivityTracking(app: Application) {
        app.registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                currentActivityRef = WeakReference(activity)
            }

            override fun onActivityPaused(activity: Activity) {
                if (currentActivityRef?.get() === activity) currentActivityRef = null
            }

            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
            override fun onActivityStarted(activity: Activity) = Unit
            override fun onActivityStopped(activity: Activity) = Unit
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
            override fun onActivityDestroyed(activity: Activity) = Unit
        })
    }

    /**
     * Creates an encrypted [Settings] instance backed by EncryptedSharedPreferences.
     * Use this when overriding the PayCraftStore Koin binding:
     *
     * ```kotlin
     * single<PayCraftStore> {
     *     PayCraftSettingsStore(PayCraftPlatform.encryptedSettings(context))
     * }
     * ```
     */
    fun encryptedSettings(context: android.content.Context): Settings {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        val prefs = EncryptedSharedPreferences.create(
            context,
            "paycraft_secure_settings",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
        return SharedPreferencesSettings(prefs)
    }

    actual fun openUrl(url: String) {
        val context = appContext ?: run {
            Logger.e("PayCraftPlatform") {
                "Android context not initialized. Call PayCraftPlatform.init(context) first."
            }
            return
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }
}
