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
 * A verified sign-in must reach `register_device` (migration 193).
 *
 * identity-token/verify binds the verified sign-in to this device's id; `register_device` consumes that claim and
 * marks the device identity-verified — the metering RPCs (allowance, balances) refuse a verified user's device
 * otherwise. The registration flow had a fast path: a still-valid stored token skipped `register_device`, and the
 * same-account re-sign-in only refreshed status. Either way the claim was never consumed and the device stayed
 * unverified. With a valid token the server's same-device branch returns the SAME token, so registering costs
 * nothing.
 */
class VerifiedSignInRegistrationTest {

    private class CountingService : PayCraftService {
        var registerCalls = 0
        override suspend fun isPremium(serverToken: String): Boolean = false
        override suspend fun getSubscription(serverToken: String): SubscriptionDto? = null
        override suspend fun isTrialEligible(serverToken: String): Boolean = false
        override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult =
            PremiumCheckResult(isPremium = false, tokenValid = true) // the fast path WOULD apply
        override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean = false
        override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean = false
        override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = null
        override suspend fun registerDevice(
            email: String,
            platform: String,
            deviceName: String,
            deviceId: String,
            mode: String,
        ): RegisterDeviceResult {
            registerCalls++
            return RegisterDeviceResult(
                TOKEN,
                conflict = false,
                conflictingDeviceName = null,
                conflictingLastSeen = null,
            )
        }
    }

    private class Store(private val email: String?) : PayCraftStore {
        override suspend fun saveEmail(email: String) = Unit
        override suspend fun getEmail(): String? = email
        override suspend fun clearEmail() = Unit
    }

    @BeforeTest
    fun seedValidToken() = DeviceTokenStore.saveToken(TOKEN)

    @AfterTest
    fun clearToken() = DeviceTokenStore.clearToken()

    @Test
    fun a_new_verified_sign_in_registers_even_with_a_valid_stored_token() = runTest {
        val service = CountingService()
        val manager =
            PayCraftBillingManager(
                service = service,
                store = Store(email = null),
                dispatcher = StandardTestDispatcher(testScheduler),
            )
        advanceUntilIdle()
        val before = service.registerCalls

        manager.onVerifiedSignIn("buyer@example.com")
        advanceUntilIdle()

        assertEquals(before + 1, service.registerCalls, "the verified sign-in must reach register_device")
    }

    @Test
    fun re_proving_the_same_account_registers_too() = runTest {
        val service = CountingService()
        val manager =
            PayCraftBillingManager(
                service = service,
                store = Store(email = "buyer@example.com"),
                dispatcher = StandardTestDispatcher(testScheduler),
            )
        advanceUntilIdle()
        val before = service.registerCalls

        manager.onVerifiedSignIn("Buyer@Example.com")
        advanceUntilIdle()

        assertEquals(before + 1, service.registerCalls, "re-proving the account must reach register_device")
    }

    private companion object {
        const val TOKEN = "srv_verified_sign_in_test"
    }
}
