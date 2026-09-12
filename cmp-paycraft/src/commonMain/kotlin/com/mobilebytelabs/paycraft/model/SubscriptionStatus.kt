package com.mobilebytelabs.paycraft.model

/** Supported OAuth identity providers for ownership verification (Gate 1). */
enum class OAuthProvider { GOOGLE, APPLE }

/**
 * How ownership was verified before a device transfer is confirmed.
 * The OTP arm was removed 2026-09-06 — OAuth is the only self-service proof.
 */
enum class VerificationMethod { OAUTH }

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

    /**
     * Active or trialing subscription.
     *
     * [trial] is non-null when the underlying subscription is currently in its
     * free-trial window (`status = 'trialing'` server-side, `trial_end > now()`).
     * Consumer UI may key on `trial != null` to show trial-specific affordances
     * ("Trial ends in N days") instead of standard premium messaging.
     */
    data class Premium(val status: SubscriptionStatus, val trial: TrialInfo? = null) : BillingState

    data class Error(val message: String) : BillingState

    /**
     * The store accepted the order but payment has not cleared yet — Play `PurchaseState.PENDING`
     * (cash, UPI mandate, or a family Ask-to-Buy awaiting approval) or StoreKit `.pending`
     * (Ask to Buy / SCA).
     *
     * This is NOT [Error] and NOT [Premium]. The buyer's money is in flight and the resolution can
     * take days; it arrives asynchronously on `NativeBillingClient.purchaseUpdates`. Rendering it
     * as an error — which the SDK did before this arm existed — tells a buyer their payment failed
     * while the store is still processing it, and is a common cause of duplicate purchases.
     *
     * @param productId the product awaiting payment, so the UI can name what is pending.
     */
    data class PaymentPending(val productId: String) : BillingState

    /**
     * Subscription exists but is bound to a different (active) device.
     *
     * Resolution priority:
     *  1. OAuth (Gate 1) — Google / Apple sign-in proves email ownership instantly.
     *  2. Manual (Gate 2) — pre-filled "Contact Support" email carrying the device +
     *     subscription details, for anyone Gate 1 cannot serve.
     *
     * A third gate (emailed one-time code, via Brevo, capped at 300 sends/day platform-wide)
     * existed until 2026-09-06 and was REMOVED — OAuth is the supported self-service path.
     * The trade-off is deliberate and worth remembering: OTP was the only self-service route for
     * custom-domain emails that cannot be linked to a Google or Apple account, so those users now
     * reach Gate 2 directly instead of resolving a device conflict themselves.
     *
     * After Gate 1 succeeds, [BillingState.OwnershipVerified] is emitted.
     */
    data class DeviceConflict(
        val email: String,
        val pendingToken: String,
        val conflictingDeviceName: String?,
        val conflictingLastSeen: String?,
        val supportEmail: String,
    ) : BillingState

    /**
     * Ownership has been verified via OAuth.
     * The UI MUST show a confirmation dialog before calling
     * [BillingManager.confirmDeviceTransfer] — the user must explicitly consent
     * to deactivating the existing device.
     */
    data class OwnershipVerified(
        val email: String,
        val pendingToken: String,
        val conflictingDeviceName: String?,
        val conflictingLastSeen: String?,
        val verifiedVia: VerificationMethod,
        val supportEmail: String,
    ) : BillingState
}
