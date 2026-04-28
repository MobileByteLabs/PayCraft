package com.mobilebytelabs.paycraft.sample.fake

import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.currentTimeMillis

class FakePayCraftStore : PayCraftStore {

    private var email: String? = null
    private var cachedStatus: SubscriptionStatus? = null
    private var lastSynced: Long = 0L

    override suspend fun saveEmail(email: String) {
        this.email = email
    }

    override suspend fun getEmail(): String? = email

    override suspend fun clearEmail() {
        email = null
    }

    override fun cacheSubscriptionStatus(status: SubscriptionStatus) {
        cachedStatus = status
        lastSynced = currentTimeMillis()
    }

    override fun getCachedSubscriptionStatus(): SubscriptionStatus? = cachedStatus

    override fun getLastSyncedAt(): Long = lastSynced

    override fun clearCache() {
        cachedStatus = null
        lastSynced = 0L
    }

    /** Pre-seed email for tests that need saved state (P3, P10, P13). */
    fun seedEmail(email: String) {
        this.email = email
    }

    /** Pre-seed cache for smart sync tests. */
    fun seedCache(status: SubscriptionStatus, syncedAt: Long = currentTimeMillis()) {
        cachedStatus = status
        lastSynced = syncedAt
    }
}
