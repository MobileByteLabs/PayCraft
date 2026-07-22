package com.mobilebytelabs.paycraft.canary.offline.green

import com.mobilebytelabs.paycraft.canary.offline.red.OfflineEntitlementRedFixture
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.persistence.EntitlementKey
import com.mobilebytelabs.paycraft.testsupport.FakePayCraftService
import com.mobilebytelabs.paycraft.testsupport.InMemoryEntitlementDao
import com.mobilebytelabs.paycraft.testsupport.entitlementDto
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours
import org.mobilenativefoundation.store.store5.StoreReadRequest
import org.mobilenativefoundation.store.store5.StoreReadResponse
import org.mobilenativefoundation.store.store5.impl.extensions.fresh

/**
 * GREEN canary (AC9): with the network disabled the SDK serves the last-known-good entitlement
 * from the Store5 SQLDelight-shaped SoT, honouring the cached `expires_at` + grace window — and
 * the naive no-SoT path ([OfflineEntitlementRedFixture]) cannot (proving the bug the SoT fixes).
 */
class OfflineEntitlementCanaryTest {

    private val expiresAtMs = 1_900_000_000_000L // fixed future-ish epoch-millis

    @Test
    fun offline_serves_last_known_good_within_window() = runTest {
        val service = FakePayCraftService(networkUp = true)
        service.seed(
            entitlementDto(
                appUserId = "u-1",
                provider = "stripe",
                canonicalState = "active",
                expiresAt = expiresAtMs,
            ),
        )
        val cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours)

        // Seed the SoT while online.
        cache.store.fresh(EntitlementKey("u-1"))

        // Network now disabled — the cached read must still emit Data from the SQLDelight-shaped SoT.
        service.networkUp = false
        val response = cache.store
            .stream(StoreReadRequest.cached(EntitlementKey("u-1"), refresh = false))
            .first { it is StoreReadResponse.Data }
        val entitlement = (response as StoreReadResponse.Data).value

        assertEquals("stripe", entitlement.provider)
        assertTrue(
            cache.isServableOffline(entitlement, now = expiresAtMs - 1_000),
            "inside the paid-through window → last-known-good must gate as premium",
        )
        assertFalse(
            cache.isServableOffline(entitlement, now = expiresAtMs + 1_000),
            "past expiry → must NOT over-serve premium offline",
        )

        // The pre-fix naive path (no Store5 SoT) revokes premium the instant the network drops.
        assertNull(
            OfflineEntitlementRedFixture.serveWithoutSoT(service, "u-1"),
            "RED: direct network read cannot serve offline — this is why the Store5 SoT exists",
        )
    }

    @Test
    fun offline_grace_window_keeps_premium_alive() = runTest {
        val service = FakePayCraftService(networkUp = true)
        service.seed(
            entitlementDto(
                appUserId = "u-2",
                provider = "play",
                canonicalState = "in_grace_period", // D6: grace = active
                expiresAt = 1_000L, // already expired…
                inGraceUntil = expiresAtMs, // …but still inside the grace window
            ),
        )
        val cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours)
        cache.store.fresh(EntitlementKey("u-2"))

        service.networkUp = false
        val response = cache.store
            .stream(StoreReadRequest.cached(EntitlementKey("u-2"), refresh = false))
            .first { it is StoreReadResponse.Data }
        val entitlement = (response as StoreReadResponse.Data).value

        assertTrue(
            cache.isServableOffline(entitlement, now = expiresAtMs - 1_000),
            "grace window still open → premium stays alive offline (grace = active)",
        )
    }
}
