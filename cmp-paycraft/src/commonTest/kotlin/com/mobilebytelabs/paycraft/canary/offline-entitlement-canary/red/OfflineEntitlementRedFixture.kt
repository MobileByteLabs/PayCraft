package com.mobilebytelabs.paycraft.canary.offline.red

import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.toEntitlement

/**
 * RED canary fixture (AC9): the DELIBERATELY BUGGY pre-fix gating — read the entitlement straight
 * from the network with NO Store5 SourceOfTruth fallback. When the network is down the fetch
 * throws and this returns null, i.e. premium is revoked on every outage.
 *
 * It is asserted from the GREEN test ([OfflineEntitlementCanaryTest]) that this path returns null
 * offline — proving the missing-SoT bug the Store5 cache fixes. Never promoted to production.
 *
 * intentional-noop: this is a red-canary fixture, not production code — the missing offline
 * fallback is the whole point.
 */
object OfflineEntitlementRedFixture {
    suspend fun serveWithoutSoT(service: PayCraftService, appUserId: String): Entitlement? =
        runCatching { service.getEntitlements(appUserId)?.toEntitlement() }.getOrNull()
}
