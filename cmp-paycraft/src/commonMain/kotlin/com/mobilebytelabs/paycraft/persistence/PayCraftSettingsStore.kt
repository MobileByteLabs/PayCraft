package com.mobilebytelabs.paycraft.persistence

import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.platform.currentTimeMillis
import com.russhwolf.settings.Settings

/**
 * Settings-backed persistence for subscription cache and email.
 *
 * Accepts an injected [Settings] instance so platforms can provide encrypted storage:
 * - **Android**: `SharedPreferencesSettings(encryptedSharedPreferences)` via EncryptedSharedPreferences
 * - **iOS**: Default `Settings()` (NSUserDefaults — encrypted at rest via iOS Data Protection)
 * - **Desktop/Web**: Default `Settings()` (acceptable risk for non-mobile)
 *
 * Falls back to default `Settings()` if no instance is injected.
 */
class PayCraftSettingsStore(private val settings: Settings = Settings()) : PayCraftStore {

    override suspend fun saveEmail(email: String) {
        settings.putString(KEY_EMAIL, email)
    }

    override suspend fun getEmail(): String? {
        val email = settings.getStringOrNull(KEY_EMAIL)
        return if (email.isNullOrBlank()) null else email
    }

    override suspend fun clearEmail() {
        settings.remove(KEY_EMAIL)
    }

    override fun cacheSubscriptionStatus(status: SubscriptionStatus) {
        settings.putBoolean(KEY_CACHED_IS_PREMIUM, status.isPremium)
        status.plan?.let { settings.putString(KEY_CACHED_PLAN, it) }
            ?: settings.remove(KEY_CACHED_PLAN)
        status.provider?.let { settings.putString(KEY_CACHED_PROVIDER, it) }
            ?: settings.remove(KEY_CACHED_PROVIDER)
        status.expiresAt?.let { settings.putString(KEY_CACHED_EXPIRES_AT, it) }
            ?: settings.remove(KEY_CACHED_EXPIRES_AT)
        settings.putBoolean(KEY_CACHED_WILL_RENEW, status.willRenew)
        settings.putLong(KEY_CACHED_LAST_SYNCED, currentTimeMillis())
    }

    override fun getCachedSubscriptionStatus(): SubscriptionStatus? {
        if (!settings.hasKey(KEY_CACHED_IS_PREMIUM)) return null
        return SubscriptionStatus(
            isPremium = settings.getBoolean(KEY_CACHED_IS_PREMIUM, false),
            plan = settings.getStringOrNull(KEY_CACHED_PLAN),
            email = settings.getStringOrNull(KEY_EMAIL),
            provider = settings.getStringOrNull(KEY_CACHED_PROVIDER),
            expiresAt = settings.getStringOrNull(KEY_CACHED_EXPIRES_AT),
            willRenew = settings.getBoolean(KEY_CACHED_WILL_RENEW, true),
        )
    }

    override fun getLastSyncedAt(): Long = settings.getLong(KEY_CACHED_LAST_SYNCED, 0L)

    override fun clearCache() {
        settings.remove(KEY_CACHED_IS_PREMIUM)
        settings.remove(KEY_CACHED_PLAN)
        settings.remove(KEY_CACHED_PROVIDER)
        settings.remove(KEY_CACHED_EXPIRES_AT)
        settings.remove(KEY_CACHED_WILL_RENEW)
        settings.remove(KEY_CACHED_LAST_SYNCED)
    }

    companion object {
        private const val KEY_EMAIL = "paycraft_subscription_email"
        private const val KEY_CACHED_IS_PREMIUM = "paycraft_cached_is_premium"
        private const val KEY_CACHED_PLAN = "paycraft_cached_plan"
        private const val KEY_CACHED_PROVIDER = "paycraft_cached_provider"
        private const val KEY_CACHED_EXPIRES_AT = "paycraft_cached_expires_at"
        private const val KEY_CACHED_WILL_RENEW = "paycraft_cached_will_renew"
        private const val KEY_CACHED_LAST_SYNCED = "paycraft_cached_last_synced"
    }
}
