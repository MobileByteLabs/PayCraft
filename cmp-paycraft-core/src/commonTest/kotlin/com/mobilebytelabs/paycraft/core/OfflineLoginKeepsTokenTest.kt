package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto
import com.mobilebytelabs.paycraft.persistence.PayCraftStore
import com.mobilebytelabs.paycraft.platform.DeviceTokenStore
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * A token check that never reached the server must not re-register the device (2026-11-17).
 *
 * Before: a stored token whose `check_premium_with_device` call THREW (offline launch, timeout) was treated as
 * revoked — cleared, then `register_device` minted a new device. Past the device limit that added a pending row
 * per launch: one Reels Downloader member collected 44 rows from 2 phones. Only a server answer of "invalid" (or
 * bound to another email) may trigger re-registration.
 */
class OfflineLoginKeepsTokenTest {

    private class Service(private val check: () -> PremiumCheckResult) : PayCraftService {
        var registerCalls = 0
        override suspend fun isPremium(serverToken: String): Boolean = false
        override suspend fun getSubscription(serverToken: String): SubscriptionDto? = null
        override suspend fun isTrialEligible(serverToken: String): Boolean = false
        override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult = check()
        override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean = false
        override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean = false
        override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = null
        override suspend fun registerDevice(email: String, platform: String, deviceName: String, deviceId: String, mode: String): RegisterDeviceResult {
            registerCalls++
            return RegisterDeviceResult(NEW_TOKEN, conflict = false, conflictingDeviceName = null, conflictingLastSeen = null)
        }
    }

    private class Store : PayCraftStore {
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = null
        override suspend fun clearEmail() = Unit
    }

    @BeforeTest
    fun seedStoredToken() = DeviceTokenStore.saveToken(STORED_TOKEN)

    @AfterTest
    fun clearToken() = DeviceTokenStore.clearToken()

    @Test
    fun an_offline_token_check_keeps_the_token_and_does_not_register() = runTest {
        val service = Service { throw IllegalStateException("Unable to resolve host") }
        val manager = PayCraftBillingManager(service = service, store = Store(), dispatcher = StandardTestDispatcher(testScheduler))
        advanceUntilIdle()

        manager.logIn("buyer@example.com")
        advanceUntilIdle()

        assertEquals(0, service.registerCalls, "a failed check must not mint a new device")
        assertEquals(STORED_TOKEN, DeviceTokenStore.getToken(), "the stored token must survive an offline launch")
    }

    @Test
    fun a_token_the_server_rejects_is_replaced() = runTest {
        // The stored token is rejected; the freshly registered one is accepted.
        val service = Service { PremiumCheckResult(isPremium = false, tokenValid = DeviceTokenStore.getToken() == NEW_TOKEN) }
        val manager = PayCraftBillingManager(service = service, store = Store(), dispatcher = StandardTestDispatcher(testScheduler))
        advanceUntilIdle()

        manager.logIn("buyer@example.com")
        advanceUntilIdle()

        assertEquals(1, service.registerCalls, "a revoked token is re-registered")
        assertEquals(NEW_TOKEN, DeviceTokenStore.getToken())
    }

    @Test
    fun a_server_that_rejects_every_token_registers_once_not_forever() = runTest {
        val service = Service { PremiumCheckResult(isPremium = false, tokenValid = false) }
        val manager = PayCraftBillingManager(service = service, store = Store(), dispatcher = StandardTestDispatcher(testScheduler))
        advanceUntilIdle()

        manager.logIn("buyer@example.com")
        advanceUntilIdle()

        assertEquals(1, service.registerCalls, "a rejected fresh token must not trigger another registration")
    }

    private companion object {
        const val STORED_TOKEN = "srv_stored_token_offline_test"
        const val NEW_TOKEN = "srv_new_token_offline_test"
    }
}
