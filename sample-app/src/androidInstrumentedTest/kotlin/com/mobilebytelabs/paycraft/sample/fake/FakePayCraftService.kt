package com.mobilebytelabs.paycraft.sample.fake

import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.network.OtpGateResult
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.network.PremiumCheckResult
import com.mobilebytelabs.paycraft.network.RegisterDeviceResult
import com.mobilebytelabs.paycraft.network.SubscriptionDto

class FakePayCraftService : PayCraftService {

    // Scriptable responses
    var isPremiumResponse: Boolean = false
    var subscriptionResponse: SubscriptionDto? = null
    var registerDeviceResponse = RegisterDeviceResult(
        deviceToken = "fake-token-123",
        conflict = false,
        conflictingDeviceName = null,
        conflictingLastSeen = null,
    )
    var checkPremiumResponse = PremiumCheckResult(isPremium = false, tokenValid = true)
    var transferResponse: Boolean = true
    var revokeResponse: Boolean = true
    var otpGateResponse = OtpGateResult(available = true, sendsToday = 0, limit = 300)
    var verifyOtpResponse: Boolean = true
    var verifyOAuthResponse: String? = null
    var shouldThrowOnCheckPremium: Exception? = null
    var shouldThrowOnRegister: Exception? = null

    // Call tracking
    var registerDeviceCallCount = 0
        private set
    var checkPremiumCallCount = 0
        private set
    var transferCallCount = 0
        private set
    var sendOtpCallCount = 0
        private set

    // Dynamic response swapping (for P10: first call returns tokenValid=false, second returns true)
    var checkPremiumResponses: MutableList<PremiumCheckResult>? = null
    private var checkPremiumCallIndex = 0

    override suspend fun isPremium(serverToken: String) = isPremiumResponse

    override suspend fun getSubscription(serverToken: String) = subscriptionResponse

    override suspend fun registerDevice(
        email: String,
        platform: String,
        deviceName: String,
        deviceId: String,
        mode: String,
    ): RegisterDeviceResult {
        registerDeviceCallCount++
        shouldThrowOnRegister?.let { throw it }
        return registerDeviceResponse
    }

    override suspend fun checkPremiumWithDevice(serverToken: String): PremiumCheckResult {
        checkPremiumCallCount++
        shouldThrowOnCheckPremium?.let { throw it }
        checkPremiumResponses?.let { list ->
            val idx = checkPremiumCallIndex.coerceAtMost(list.lastIndex)
            checkPremiumCallIndex++
            return list[idx]
        }
        return checkPremiumResponse
    }

    override suspend fun transferToDevice(serverToken: String, newDeviceToken: String): Boolean {
        transferCallCount++
        return transferResponse
    }

    override suspend fun revokeDevice(serverToken: String, targetToken: String) = revokeResponse

    override suspend fun checkOtpGate() = otpGateResponse

    override suspend fun sendOtp(email: String) {
        sendOtpCallCount++
    }

    override suspend fun verifyOtp(email: String, token: String) = verifyOtpResponse

    override suspend fun verifyOAuthToken(provider: OAuthProvider, idToken: String) = verifyOAuthResponse

    fun reset() {
        registerDeviceCallCount = 0
        checkPremiumCallCount = 0
        transferCallCount = 0
        sendOtpCallCount = 0
        checkPremiumCallIndex = 0
        checkPremiumResponses = null
    }
}
