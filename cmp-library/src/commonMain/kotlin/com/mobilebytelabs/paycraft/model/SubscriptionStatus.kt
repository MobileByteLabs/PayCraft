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
}
