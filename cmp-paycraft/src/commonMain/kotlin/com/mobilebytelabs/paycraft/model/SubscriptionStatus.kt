package com.mobilebytelabs.paycraft.model

/** Supported OAuth identity providers for ownership verification (Gate 1). */
enum class OAuthProvider { GOOGLE, APPLE }

/** How ownership was verified before a device transfer is confirmed. */
enum class VerificationMethod { OAUTH, OTP }

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
     *
     * Resolution priority:
     *  1. OAuth (Gate 1) — Google / Apple sign-in proves email ownership instantly.
     *     Used when the user's email can be linked to a Google or Apple account.
     *  2. OTP (Gate 2) — 6-digit code sent via Brevo. Used for custom-domain emails.
     *     Limited to [otpDailyLimit] per day; [otpAvailable] = false when exhausted.
     *  3. Manual (Gate 3) — [otpAvailable] = false. UI shows pre-filled "Contact Support"
     *     email button with all device + subscription info.
     *
     * After Gate 1 or Gate 2 succeeds, [BillingState.OwnershipVerified] is emitted.
     */
    data class DeviceConflict(
        val email: String,
        val pendingToken: String,
        val conflictingDeviceName: String?,
        val conflictingLastSeen: String?,
        /** False when daily OTP send limit is reached → show Manual gate. */
        val otpAvailable: Boolean,
        val otpDailyLimit: Int,
        val supportEmail: String,
    ) : BillingState

    /**
     * Ownership has been verified (via OAuth or OTP).
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
