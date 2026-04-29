package com.mobilebytelabs.paycraft

import android.content.Intent
import android.net.Uri
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import co.touchlab.kermit.Logger
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import com.russhwolf.settings.Settings
import com.russhwolf.settings.SharedPreferencesSettings

actual object PayCraftPlatform {
    private var appContext: android.content.Context? = null

    fun init(context: android.content.Context) {
        appContext = context.applicationContext
        DeviceTokenStore.init(context.applicationContext)
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
