package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.SubscriptionState
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.testsupport.FakePayCraftService
import com.mobilebytelabs.paycraft.testsupport.InMemoryEntitlementDao
import com.mobilebytelabs.paycraft.testsupport.SpyNativeBillingClient
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * AC6: [EntitlementRepository.manageSubscription] dispatches the correct cancel/manage path per
 * provider — native store providers (`play`/`app_store`) deep-link the store subscription centre
 * (stores forbid programmatic cancel), PSP providers (`stripe`/`razorpay`) call the engine's
 * PSP-API cancel.
 */
class CancelDispatchTest {

    private fun entitlement(provider: String) = Entitlement(
        userId = "u-1",
        provider = provider,
        product = "pro_monthly",
        canonicalState = SubscriptionState.Active,
        expiresAt = null,
        willRenew = true,
        subscriptionId = "sub_${provider}_1",
        latestEventTs = 0L,
    )

    @Test
    fun store_providers_deep_link_psp_providers_call_api() = runTest {
        val native = SpyNativeBillingClient()
        val service = FakePayCraftService(networkUp = true)
        val repo = EntitlementRepository(
            cache = EntitlementCache(service, InMemoryEntitlementDao()),
            native = native,
            service = service,
        )

        assertTrue(repo.manageSubscription(entitlement("play")))       // Android store → deep link
        assertTrue(repo.manageSubscription(entitlement("app_store")))  // iOS store → showManageSubscriptions
        assertTrue(repo.manageSubscription(entitlement("stripe")))     // PSP → API cancel
        assertTrue(repo.cancel(entitlement("razorpay")))               // PSP → API cancel (cancel alias)

        assertEquals(2, native.manageCalls, "both store providers dispatch to the native deep-link")
        assertEquals(
            listOf("stripe", "razorpay"),
            service.cancelledProviders,
            "PSP providers dispatch to the engine's cancelSubscription API",
        )
    }
}
