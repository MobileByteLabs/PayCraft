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
        prefs = try {
            createEncryptedPrefs(context)
        } catch (e: Exception) {
            // EncryptedSharedPreferences throws AEADBadTagException / KeyStoreException when the
            // Tink keyset can't be decrypted by the Android Keystore master key. This happens after
            // an auto-backup restore to a NEW device (the encrypted prefs file is restored, but the
            // device-bound Keystore master key is not), a keystore reset, or repeated reinstalls.
            // Because init() runs in PayCraftInitializer (an androidx.startup ContentProvider), an
            // uncaught throw here crashes the whole app at launch. Recover by wiping the corrupt
            // keyset + master key and recreating fresh (the device simply re-registers next call).
            runCatching { context.deleteSharedPreferences(PREFS_FILE) }
            runCatching {
                java.security.KeyStore.getInstance("AndroidKeyStore")
                    .apply { load(null) }
                    .deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
            }
            runCatching { createEncryptedPrefs(context) }.getOrNull()
        }
    }

    private fun createEncryptedPrefs(context: Context): SharedPreferences {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        return EncryptedSharedPreferences.create(
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
