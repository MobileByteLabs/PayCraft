package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.billing.NativePurchase
import com.mobilebytelabs.paycraft.model.SubscriptionState
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.testsupport.FakePayCraftService
import com.mobilebytelabs.paycraft.testsupport.InMemoryEntitlementDao
import com.mobilebytelabs.paycraft.testsupport.SpyNativeBillingClient
import com.mobilebytelabs.paycraft.testsupport.entitlementDto
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.hours

/**
 * Store-only buyers (no sign-in) must survive a reinstall / new phone, and signing in must carry a
 * store purchase to the other platform.
 *
 * The anonymous app-user-id is a device id — it CHANGES on reinstall (iOS identifierForVendor) and
 * on a new phone, while the store account does not. Restore used to call the store, DISCARD what it
 * returned, and ask the server about the new device id, which owned nothing: the buyer read Free.
 */
class StoreRestoreRelinkTest {

    private val subToken = "play-token-annual"
    private fun purchase(pending: Boolean = false) = NativePurchase(
        productId = "pro_annual",
        purchaseToken = subToken,
        originalTransactionId = null,
        purchaseTimeMillis = 1_000L,
        isAutoRenewing = true,
        packageName = "com.example.app",
        isPending = pending,
    )

    /** The server already holds the purchase under the ORIGINAL install's device id. */
    private fun serverWithAnonymousPurchase() = FakePayCraftService().apply {
        val dto = entitlementDto(
            appUserId = "device-a",
            provider = "google_play",
            canonicalState = "active",
            expiresAt = 1_900_000_000_000L,
            subscriptionId = subToken,
        )
        seed(dto)
        storeTruth[subToken] = dto
    }

    private fun repo(service: FakePayCraftService, native: SpyNativeBillingClient, platform: String) =
        EntitlementRepository(
            cache = EntitlementCache(service, InMemoryEntitlementDao(), ttl = 24.hours),
            native = native,
            service = service,
            platform = { platform },
        )

    @Test
    fun reinstall_restore_without_sign_in_is_active_under_the_new_device_id() = runTest {
        val service = serverWithAnonymousPurchase()
        val native = SpyNativeBillingClient().apply { storePurchases = listOf(purchase()) }

        val entitlement = repo(service, native, "android").restore("device-b")

        assertEquals(SubscriptionState.Active, entitlement.canonicalState)
        assertEquals(listOf(subToken to "device-b"), service.registered, "restore must re-bind what the store returned")
    }

    @Test
    fun a_pending_purchase_is_not_registered_on_restore() = runTest {
        val service = serverWithAnonymousPurchase()
        val native = SpyNativeBillingClient().apply { storePurchases = listOf(purchase(pending = true)) }

        runCatching { repo(service, native, "android").restore("device-b") }

        assertTrue(service.registered.isEmpty(), "payment has not cleared — nothing to bind")
    }

    @Test
    fun sign_in_carries_a_store_purchase_to_the_other_platform() = runTest {
        val service = serverWithAnonymousPurchase()

        // Android: the buyer signs in — the purchase the store holds is re-bound to their email.
        val linked = service.relinkStorePurchases(
            listOf(purchase()),
            appUserId = "buyer@example.com",
            platform = "android",
        )
        assertEquals(1, linked)

        // iOS: a different store account (it returns nothing), same signed-in identity.
        val iosNative = SpyNativeBillingClient()
        val ios = repo(service, iosNative, "ios").restore("buyer@example.com")
        assertEquals(SubscriptionState.Active, ios.canonicalState, "signed in → entitled on the second platform")
    }
}
