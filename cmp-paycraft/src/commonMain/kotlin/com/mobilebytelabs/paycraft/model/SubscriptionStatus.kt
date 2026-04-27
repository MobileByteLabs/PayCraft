package com.mobilebytelabs.paycraft.model

data class SubscriptionStatus(
    val isPremium: Boolean = false,
    val plan: String? = null,
    val email: String? = null,
    val provider: String? = null,
    val expiresAt: String? = null,
    val willRenew: Boolean = true,
)

sealed interface BillingState {
    data object Loading : BillingState
    data object Free : BillingState
    data class Premium(val status: SubscriptionStatus) : BillingState
    data class Error(val message: String) : BillingState

    /**
     * Subscription exists but is bound to a different (active) device.
     * [pendingToken] is the server-issued token for THIS device — stored locally,
     * activated only after ownership is verified via [BillingManager.transferToDevice].
     */
    data class DeviceConflict(
        val email: String,
        val pendingToken: String,
        val conflictingDeviceName: String?,
        val conflictingLastSeen: String?,
        val otpAvailable: Boolean,
        val supportEmail: String,
    ) : BillingState
}
