package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Emitted exactly once on the rising edge when a subscription transitions from
 * non-premium → premium/active.  Consumers (e.g. [PayCraftCheckoutSuccessSheet])
 * collect this to trigger success UX without polling [BillingManager.isPremium].
 *
 * @param sku   The activated plan identifier (e.g. `"monthly"`, `"annual"`), or
 *              `null` if the plan could not be resolved from the server response.
 * @param isTrial `true` when the subscription is currently in its free-trial window.
 */
data class SubscriptionActivated(val sku: String?, val isTrial: Boolean)

interface BillingManager {
    val isPremium: StateFlow<Boolean>
    val subscriptionStatus: StateFlow<SubscriptionStatus>
    val billingState: StateFlow<BillingState>
    val userEmail: StateFlow<String?>

    /**
     * Hot stream that emits [SubscriptionActivated] exactly once each time the
     * subscription transitions from non-premium → premium.  Replay is 0 — late
     * collectors will not receive historical events.
     *
     * Typical usage:
     * ```kotlin
     * billingManager.subscriptionActivated
     *     .onEach { event -> showSuccessSheet(event) }
     *     .launchIn(viewModelScope)
     * ```
     */
    val subscriptionActivated: SharedFlow<SubscriptionActivated>

    /**
     * True iff the current subscription is in its free-trial window
     * (`status = 'trialing'` and `trial_end > now()` server-side).
     *
     * Standalone flow for direct binding from consumer UI — equivalent to
     * `(billingState as? BillingState.Premium)?.trial != null` but avoids
     * `when`-block boilerplate. Refreshed on every [refreshStatus].
     */
    val isInTrial: StateFlow<Boolean>

    /**
     * ISO-8601 UTC timestamp when the current trial ends, or null if not in a trial.
     * Mirrors [com.mobilebytelabs.paycraft.model.TrialInfo.endsAt] for direct
     * `collectAsState()` binding. Refreshed on every [refreshStatus].
     */
    val trialEndsAt: StateFlow<String?>

    /**
     * Google Play Billing purchase lane (Payments-policy compliance).
     *
     * Called for an **Android digital** checkout instead of opening a web payment page. Drives
     * [billingState]: Loading → then Premium (on success + server entitlement grant) / Free (user
     * cancelled) / Error (failure OR a missing `play_product_id` — which is BLOCKED, never a browser
     * fallback). No-op-with-error on platforms/builds where no native billing client is wired.
     *
     * @param plan the plan to purchase; its [com.mobilebytelabs.paycraft.model.BillingPlan.playProductId]
     *   is the Play product id. Blank/null → [BillingState.Error], never a web fallback (anti-steering).
     * @param email the buyer email (already logged-in by the paywall), used as the stable app-user-id.
     */
    fun purchaseViaPlayBilling(plan: com.mobilebytelabs.paycraft.model.BillingPlan, email: String?)

    /**
     * Apple StoreKit in-app-purchase lane (Apple Guideline 3.1.1 compliance).
     *
     * Called for an **iOS/macOS digital** checkout instead of opening a web payment page — a web
     * checkout for a digital subscription on iOS is a 3.1.1 rejection. Drives [billingState]:
     * Loading → then Premium / Free (user cancelled) / Error (failure OR a missing
     * `app_store_product_id` — which is BLOCKED, never a browser fallback). No-op-with-error on
     * platforms/builds where no native billing client is wired.
     *
     * Unlike [purchaseViaPlayBilling] there is no client-facing StoreKit grant endpoint today:
     * entitlement truth lands server-side via the Apple App Store Server Notifications (ASSN-V2)
     * webhook, so on success this reconciles through the normal server refresh path rather than an
     * immediate client-side register call.
     *
     * @param plan the plan to purchase; its [com.mobilebytelabs.paycraft.model.BillingPlan.appStoreProductId]
     *   is the App Store product id. Blank/null → [BillingState.Error], never a web fallback (anti-steering).
     * @param email the buyer email (already logged-in by the paywall), used as the stable app-user-id.
     */
    fun purchaseViaStoreKit(plan: com.mobilebytelabs.paycraft.model.BillingPlan, email: String?)

    /** Registers this device with the server and checks premium status. Replaces logIn(). */
    fun registerAndLogin(email: String)

    /** Legacy — kept for backward compatibility. Delegates to registerAndLogin(). */
    fun logIn(email: String)

    /**
     * Server-derived trial eligibility (TR-006).
     *
     * Returns `true` if the current user (resolved via device token) has not yet
     * consumed a free trial — i.e. no historical subscription row records a
     * `trial_end`. The UI uses this to suppress the trial CTA for repeat users.
     *
     * On any failure (network, no token, no email), returns `true` (optimistic
     * — let the server reject at checkout time rather than block first-time
     * users behind a flaky network call).
     */
    suspend fun checkTrialEligibility(): Boolean

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
     * Called after [BillingState.OwnershipVerified] is emitted and the user
     * confirms the "Deactivate [device] and transfer here?" dialog.
     * Executes the transfer and emits [BillingState.Premium] or [BillingState.Error].
     */
    suspend fun confirmDeviceTransfer()

    // ─── Legacy / internal ───────────────────────────────────────────────────

    /** Transfers subscription to this device (internal — called by confirmDeviceTransfer). */
    suspend fun transferToDevice()

    /** Revokes the current device registration. User will need to re-register. */
    suspend fun revokeCurrentDevice()

    fun logOut()
}
