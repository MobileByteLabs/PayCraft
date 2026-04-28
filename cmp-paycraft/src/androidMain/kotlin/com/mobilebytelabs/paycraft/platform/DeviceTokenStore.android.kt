package com.mobilebytelabs.paycraft.platform

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Android: AES256-GCM EncryptedSharedPreferences backed by Android Keystore.
 * Token survives reinstall when android:allowBackup="true" + backup rules include "paycraft_secure.xml".
 *
 * Call DeviceTokenStore.init(context) from Application.onCreate() or PayCraftPlatform.init(context).
 */
actual object DeviceTokenStore {
    private const val PREFS_FILE = "paycraft_secure"
    private const val KEY = "device_token"

    private var prefs: SharedPreferences? = null
    internal var applicationContext: Context? = null

    fun init(context: Context) {
        applicationContext = context.applicationContext
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        prefs = EncryptedSharedPreferences.create(
            context,
            PREFS_FILE,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    actual fun getToken(): String? = prefs?.getString(KEY, null)

    actual fun saveToken(token: String) {
        prefs?.edit()?.putString(KEY, token)?.apply()
    }

    actual fun clearToken() {
        prefs?.edit()?.remove(KEY)?.apply()
    }
}
