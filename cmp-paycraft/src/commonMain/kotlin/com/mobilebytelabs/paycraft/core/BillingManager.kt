package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.flow.StateFlow

interface BillingManager {
    val isPremium: StateFlow<Boolean>
    val subscriptionStatus: StateFlow<SubscriptionStatus>
    val billingState: StateFlow<BillingState>
    val userEmail: StateFlow<String?>

    /** Registers this device with the server and checks premium status. Replaces logIn(). */
    fun registerAndLogin(email: String)

    /** Legacy — kept for backward compatibility. Delegates to registerAndLogin(). */
    fun logIn(email: String)

    /** Refreshes premium status using stored device token. */
    fun refreshStatus()

    /** Called after OAuth or OTP verification to transfer subscription to this device. */
    suspend fun transferToDevice()

    /** Sends an OTP to the given email for ownership verification. */
    suspend fun requestOtpVerification(email: String)

    /** Verifies the OTP code. Returns true if correct. */
    suspend fun verifyOtp(email: String, otp: String): Boolean

    /** Revokes the current device registration. User will need to re-register. */
    suspend fun revokeCurrentDevice()

    fun logOut()
}
