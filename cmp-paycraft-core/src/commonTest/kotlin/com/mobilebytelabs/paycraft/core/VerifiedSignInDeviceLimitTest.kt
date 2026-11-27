package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.network.ActiveDevice
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
import kotlin.test.assertIs

/**
 * A sign-in that was already VERIFIED and then hits the device limit is past the ownership gate.
 *
 * It used to land on [BillingState.DeviceConflict] — the screen that asks the buyer to sign in to prove the
 * account — so a buyer who had just signed in (the app's own sign-in, or PayCraft's) was asked to sign in again
 * instead of being shown their devices to remove one (Reels, 2026-11-27). The conflict now goes straight to
 * [BillingState.OwnershipVerified], carrying the devices and the limit.
 */
class VerifiedSignInDeviceLimitTest {

    private val devices = listOf(ActiveDevice(ref = "d1", name = "Chrome on macOS", platform = "web", lastSeen = null))

    private inner class LimitService : PayCraftService {
        override suspend fun isPremium(serverToken: String): Boolean = false
        override suspend fun getSubscription(serverToken: String): SubscriptionDto? = null
        override suspend fun isTrialEligible(serverToken: String): Boolean = false
        override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult =
            PremiumCheckResult(isPremium = false, tokenValid = true)
        override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean = false
        override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean = false
        override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = null
        override suspend fun registerDevice(
            email: String,
            platform: String,
            deviceName: String,
            deviceId: String,
            mode: String,
        ): RegisterDeviceResult = RegisterDeviceResult(
            PENDING,
            conflict = true,
            conflictingDeviceName = "Chrome on macOS",
            conflictingLastSeen = null,
            activeDevices = devices,
            maxDevices = 1,
        )
    }

    private class Store : PayCraftStore {
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = null
        override suspend fun clearEmail() = Unit
    }

    @BeforeTest
    fun clean() = DeviceTokenStore.clearToken()

    @AfterTest
    fun clear() = DeviceTokenStore.clearToken()

    @Test
    fun a_verified_sign_in_at_the_device_limit_offers_the_device_picker() = runTest {
        val manager = PayCraftBillingManager(
            service = LimitService(),
            store = Store(),
            dispatcher = StandardTestDispatcher(testScheduler),
        )
        advanceUntilIdle()

        manager.onVerifiedSignIn("buyer@example.com")
        advanceUntilIdle()

        val state = assertIs<BillingState.OwnershipVerified>(manager.billingState.value)
        assertEquals("buyer@example.com", state.email)
        assertEquals(PENDING, state.pendingToken)
        assertEquals(devices, state.activeDevices)
        assertEquals(1, state.maxDevices)
    }

    private companion object {
        const val PENDING = "srv_pending_device_limit"
    }
}
