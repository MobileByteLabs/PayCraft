package com.mobilebytelabs.paycraft.persistence

import com.russhwolf.settings.MapSettings
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The capability [PayCraftStore] gained when it became the `core/store` facade.
 *
 * These assert the SHIPPED implementation, not the interface defaults. An interface member with a
 * default that no implementation overrides is a declared capability that silently does nothing —
 * the shape that lets a host believe an ad unlock persisted when it never left memory.
 */
class PayCraftStoreCapabilityTest {

    private fun store() = PayCraftSettingsStore(MapSettings())

    @Test
    fun adUnlock_roundTrips() {
        val s = store()
        val future = Long.MAX_VALUE / 2
        s.saveAdUnlock("insights", future)
        assertEquals(future, s.getAdUnlockExpiry("insights"))
    }

    @Test
    fun adUnlock_absentFeatureIsNull() {
        assertNull(store().getAdUnlockExpiry("never-granted"))
    }

    @Test
    fun adUnlock_expiredGrantReadsAsAbsent() {
        // The whole reason expiry is stored ABSOLUTE: a past timestamp must not unlock anything,
        // and must not keep being re-read as a live grant.
        val s = store()
        s.saveAdUnlock("soundscapes", 1L) // 1970
        assertNull(s.getAdUnlockExpiry("soundscapes"))
    }

    @Test
    fun adUnlock_expiredGrantIsEvicted() {
        // Without eviction the key set grows for the life of the install on an app that gates many
        // features — every expired grant left behind forever.
        val s = store()
        s.saveAdUnlock("a", 1L)
        s.getAdUnlockExpiry("a")
        assertTrue(s.getAllAdUnlocks().isEmpty(), "an expired grant must not survive a read")
    }

    @Test
    fun adUnlock_grantsAreIndependentPerFeature() {
        // Unlocking insights must not unlock soundscapes — grants are per featureKey by contract.
        val s = store()
        val future = Long.MAX_VALUE / 2
        s.saveAdUnlock("insights", future)
        assertNull(s.getAdUnlockExpiry("soundscapes"))
        assertEquals(setOf("insights"), s.getAllAdUnlocks().keys)
    }

    @Test
    fun adUnlock_clearRemovesOnlyThatFeature() {
        val s = store()
        val future = Long.MAX_VALUE / 2
        s.saveAdUnlock("a", future)
        s.saveAdUnlock("b", future)
        s.clearAdUnlock("a")
        assertNull(s.getAdUnlockExpiry("a"))
        assertEquals(future, s.getAdUnlockExpiry("b"))
    }

    @Test
    fun deviceToken_roundTripsAndClears() {
        val s = store()
        assertNull(s.getDeviceToken())
        s.saveDeviceToken("dev-123")
        assertEquals("dev-123", s.getDeviceToken())
        s.clearDeviceToken()
        assertNull(s.getDeviceToken())
    }

    @Test
    fun clearAll_wipesEverySurface() = runTest {
        // The sign-out call. A wipe that leaves any one of these behind shows the NEXT user the
        // previous user's state — an email, a cached premium flag, or an ad grant they did not earn.
        val s = store()
        s.saveEmail("buyer@example.com")
        s.saveDeviceToken("dev-123")
        s.saveAdUnlock("insights", Long.MAX_VALUE / 2)

        s.clearAll()

        assertNull(s.getEmail(), "email survived sign-out")
        assertNull(s.getDeviceToken(), "device token survived sign-out")
        assertTrue(s.getAllAdUnlocks().isEmpty(), "ad grants survived sign-out")
        assertNull(s.getCachedSubscriptionStatus(), "cached entitlement survived sign-out")
    }
}
