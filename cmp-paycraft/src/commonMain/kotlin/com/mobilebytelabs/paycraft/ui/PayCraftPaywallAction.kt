package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.OAuthProvider

sealed interface PayCraftPaywallAction {
    data class SelectPlan(val plan: BillingPlan) : PayCraftPaywallAction
    data class UpdateEmail(val email: String) : PayCraftPaywallAction
    data object Subscribe : PayCraftPaywallAction
    data object ManageSubscription : PayCraftPaywallAction
    data object LogIn : PayCraftPaywallAction
    data object LogOut : PayCraftPaywallAction
    data object Dismiss : PayCraftPaywallAction
    data object RefreshStatus : PayCraftPaywallAction
    data object ContactSupport : PayCraftPaywallAction
    data object ClearError : PayCraftPaywallAction
    data class RestoreSubscription(val email: String) : PayCraftPaywallAction
    data object ClearRestoreResult : PayCraftPaywallAction

    // ─── Device conflict resolution ──────────────────────────────────────────

    /**
     * Gate 1: OAuth ownership verification.
     * Client app triggers platform OAuth, then dispatches this with the resulting idToken.
     * On success → billingState = OwnershipVerified → confirmation dialog shown.
     */
    data class LoginWithOAuth(val provider: OAuthProvider, val idToken: String) : PayCraftPaywallAction

    /**
     * Gate 2: OTP ownership verification (for custom-domain emails).
     * Dispatched after user enters the OTP code sent to their email.
     * On success → billingState = OwnershipVerified → confirmation dialog shown.
     */
    data class VerifyOtpOwnership(val email: String, val otp: String) : PayCraftPaywallAction

    /**
     * Final step: user confirmed "Deactivate [device] and transfer here?" dialog.
     * Executes the device transfer. Only valid when billingState = OwnershipVerified.
     */
    data object ConfirmDeviceTransfer : PayCraftPaywallAction

    /**
     * User cancelled the transfer confirmation dialog.
     * Returns billingState to DeviceConflict (same conflict, no change).
     */
    data object CancelDeviceTransfer : PayCraftPaywallAction

    /**
     * Gate 3: OTP exhausted (>300/day). Opens a pre-filled support email.
     * The email contains: user email, device name, subscription info, timestamp.
     */
    data object ContactSupportManualTransfer : PayCraftPaywallAction
}
