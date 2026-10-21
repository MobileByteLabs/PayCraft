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

    // ── Ad-unlock grants ─────────────────────────────────────────────────────────────────────────
    //
    // Stored as absolute expiry millis, one key per featureKey. Absolute, not a remaining duration:
    // a duration would silently extend itself on every process restart, so an ad watched once would
    // unlock the feature forever.
    //
    // An EXPIRED grant is treated as absent AND removed on read, so the key set cannot grow without
    // bound for an app that gates many features.

    override fun getAdUnlockExpiry(featureKey: String): Long? {
        val at = settings.getLong(adUnlockKey(featureKey), 0L)
        if (at <= 0L) return null
        if (at <= currentTimeMillis()) {
            settings.remove(adUnlockKey(featureKey))
            settings.remove(KEY_AD_UNLOCK_INDEX + featureKey)
            return null
        }
        return at
    }

    override fun saveAdUnlock(featureKey: String, expiresAtEpochMillis: Long) {
        settings.putLong(adUnlockKey(featureKey), expiresAtEpochMillis)
        // multiplatform-settings has no portable key enumeration, so the index is what makes
        // getAllAdUnlocks() and the sign-out wipe possible at all.
        settings.putBoolean(KEY_AD_UNLOCK_INDEX + featureKey, true)
    }

    override fun clearAdUnlock(featureKey: String) {
        settings.remove(adUnlockKey(featureKey))
        settings.remove(KEY_AD_UNLOCK_INDEX + featureKey)
    }

    override fun getAllAdUnlocks(): Map<String, Long> = settings.keys
        .asSequence()
        .filter { it.startsWith(KEY_AD_UNLOCK_INDEX) }
        .map { it.removePrefix(KEY_AD_UNLOCK_INDEX) }
        .mapNotNull { key -> getAdUnlockExpiry(key)?.let { key to it } }
        .toMap()

    // ── Device token ─────────────────────────────────────────────────────────────────────────────

    override fun getDeviceToken(): String? = settings.getStringOrNull(KEY_DEVICE_TOKEN)

    override fun saveDeviceToken(token: String) = settings.putString(KEY_DEVICE_TOKEN, token)

    override fun clearDeviceToken() = settings.remove(KEY_DEVICE_TOKEN)

    // ── Consumable grant in flight ───────────────────────────────────────────────────────────────
    //
    // Written BEFORE the server is debited so a crash mid-drain is recoverable (ConsumableDrainer).
    // Three primitive keys rather than a serialized blob: there is at most ONE pending grant, the
    // shape is fixed, and a half-written blob would be unparseable in exactly the crash this exists
    // to survive. The grantId is written LAST and read FIRST, so a torn write reads as "nothing
    // pending" — which re-drains from the server balance, the safe direction.

    override fun saveConsumablePending(grantId: String, sku: String, quantity: Int) {
        settings.putString(KEY_PENDING_SKU, sku)
        settings.putInt(KEY_PENDING_QUANTITY, quantity)
        settings.putString(KEY_PENDING_GRANT_ID, grantId)
    }

    override fun getConsumablePending(): ConsumablePending? {
        val grantId = settings.getStringOrNull(KEY_PENDING_GRANT_ID) ?: return null
        val sku = settings.getStringOrNull(KEY_PENDING_SKU) ?: return null
        val quantity = settings.getInt(KEY_PENDING_QUANTITY, 0)
        if (quantity <= 0) return null
        return ConsumablePending(grantId = grantId, sku = sku, quantity = quantity)
    }

    override fun clearConsumablePending() {
        settings.remove(KEY_PENDING_GRANT_ID)
        settings.remove(KEY_PENDING_SKU)
        settings.remove(KEY_PENDING_QUANTITY)
    }

    private fun adUnlockKey(featureKey: String) = KEY_AD_UNLOCK_PREFIX + featureKey

    companion object {
        private const val KEY_EMAIL = "paycraft_subscription_email"
        private const val KEY_CACHED_IS_PREMIUM = "paycraft_cached_is_premium"
        private const val KEY_CACHED_PLAN = "paycraft_cached_plan"
        private const val KEY_CACHED_PROVIDER = "paycraft_cached_provider"
        private const val KEY_CACHED_EXPIRES_AT = "paycraft_cached_expires_at"
        private const val KEY_CACHED_WILL_RENEW = "paycraft_cached_will_renew"
        private const val KEY_CACHED_LAST_SYNCED = "paycraft_cached_last_synced"
        private const val KEY_AD_UNLOCK_PREFIX = "paycraft_ad_unlock_"
        private const val KEY_AD_UNLOCK_INDEX = "paycraft_ad_unlock_idx_"
        private const val KEY_DEVICE_TOKEN = "paycraft_device_token"
        private const val KEY_PENDING_GRANT_ID = "paycraft_pending_grant_id"
        private const val KEY_PENDING_SKU = "paycraft_pending_grant_sku"
        private const val KEY_PENDING_QUANTITY = "paycraft_pending_grant_quantity"
    }
}
