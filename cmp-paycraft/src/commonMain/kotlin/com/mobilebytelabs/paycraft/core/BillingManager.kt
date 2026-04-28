package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
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

    /**
     * Refreshes premium status using stored device token.
     *
     * Respects [SyncPolicy] by default — skips the network call if the local cache
     * is still fresh. Pass [force] = true to always fetch from Supabase (e.g., after
     * returning from a payment checkout where the server state may have changed).
     */
    fun refreshStatus(force: Boolean = false)

    /**
     * PRIMARY ownership verification gate (Gate 1).
     *
     * Verifies a Google or Apple ID token via Supabase Auth, extracts the verified email,
     * and registers this device. The client app is responsible for triggering the platform
     * OAuth flow and passing the resulting ID token here.
     *
     * After this call, [billingState] emits [BillingState.Premium], [BillingState.Free],
     * [BillingState.DeviceConflict], or [BillingState.Error].
     */
    suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String)

    // ─── Device conflict resolution ──────────────────────────────────────────

    /**
     * Gate 1 — verify ownership via OTP code.
     * Only use when OAuth is unavailable (custom-domain emails).
     * On success, [billingState] emits [BillingState.OwnershipVerified].
     * Returns false if the code is wrong.
     */
    suspend fun verifyOtpOwnership(email: String, otp: String): Boolean

    /**
     * Called after [BillingState.OwnershipVerified] is emitted and the user
     * confirms the "Deactivate [device] and transfer here?" dialog.
     * Executes the transfer and emits [BillingState.Premium] or [BillingState.Error].
     */
    suspend fun confirmDeviceTransfer()

    // ─── Legacy / internal ───────────────────────────────────────────────────

    /** @deprecated Use [verifyOtpOwnership] for conflict resolution. */
    suspend fun requestOtpVerification(email: String)

    /** Internal: sends OTP via Supabase Auth. */
    suspend fun verifyOtp(email: String, otp: String): Boolean

    /** Transfers subscription to this device (internal — called by confirmDeviceTransfer). */
    suspend fun transferToDevice()

    /** Revokes the current device registration. User will need to re-register. */
    suspend fun revokeCurrentDevice()

    fun logOut()
}
