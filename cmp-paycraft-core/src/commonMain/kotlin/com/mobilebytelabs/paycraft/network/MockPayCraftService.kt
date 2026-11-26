package com.mobilebytelabs.paycraft.network

import com.mobilebytelabs.paycraft.PayCraftBackend
import com.mobilebytelabs.paycraft.model.OAuthProvider
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The [PayCraftService] for [PayCraftBackend.Mock]: devices, tokens and entitlements kept in memory, nothing sent
 * anywhere.
 *
 * Mock promises an offline preview, but its backend URL is `mock://`, which the Supabase client turns into
 * https://localhost — so binding the real service made every login on Mock fail with "register_device … Connection
 * refused". Here a buyer is Free: Premium on Mock comes from a store purchase or a test's fake, never this service.
 */
class MockPayCraftService : PayCraftService {

    private val lock = Mutex()
    private val emailByToken = mutableMapOf<String, String>()

    override suspend fun registerDevice(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String,
    ): RegisterDeviceResult {
        val normalized = email.trim().lowercase()
        val token = "mock_${platform}_${deviceId}_$normalized"
        lock.withLock { emailByToken[token] = normalized }
        return RegisterDeviceResult(
            deviceToken = token,
            conflict = false,
            conflictingDeviceName = null,
            conflictingLastSeen = null,
        )
    }

    override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult {
        val email = lock.withLock { emailByToken[serverToken] }
        return PremiumCheckResult(isPremium = false, tokenValid = email != null, boundEmail = email)
    }

    override suspend fun isPremium(serverToken: String): Boolean = false

    override suspend fun getSubscription(serverToken: String): SubscriptionDto? = null

    override suspend fun isTrialEligible(serverToken: String): Boolean = true

    override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean = true

    override suspend fun revokeDevice(serverToken: String, targetToken: String): Boolean =
        lock.withLock { emailByToken.remove(targetToken) != null }

    /** No identity provider to ask offline; sign-in on Mock goes through [registerDevice] with a typed email. */
    override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String): String? = null
}
