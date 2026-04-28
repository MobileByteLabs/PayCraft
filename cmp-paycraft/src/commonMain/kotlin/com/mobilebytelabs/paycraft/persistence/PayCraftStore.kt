package com.mobilebytelabs.paycraft.persistence

import com.mobilebytelabs.paycraft.model.SubscriptionStatus

interface PayCraftStore {
    suspend fun saveEmail(email: String)
    suspend fun getEmail(): String?
    suspend fun clearEmail()

    // Subscription cache — non-suspend for synchronous init reads
    fun cacheSubscriptionStatus(status: SubscriptionStatus) {}
    fun getCachedSubscriptionStatus(): SubscriptionStatus? = null
    fun getLastSyncedAt(): Long = 0L
    fun clearCache() {}
}
