package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.flow.MutableStateFlow
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

internal interface BillingManager {
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
     * @param plan the plan to purchase; its [com.mobilebytelabs.paycraft.model.BillingPlan.storeBinding]
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
     * @param plan the plan to purchase; its [com.mobilebytelabs.paycraft.model.BillingPlan.storeBinding]
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

    // ─── Consumable balances (REQUIREMENTS.md PC-001..006) ───────────────────

    /**
     * Server-authoritative consumable balances, keyed by sku.
     *
     * READ-ONLY and there is deliberately no local increment path (AR-013): a client-writable
     * balance is forgeable currency. Every value here came from the server — either a
     * [refreshBalance] read or the new balance a successful [spend] returned. A sku absent from the
     * map has simply not been read yet; it is NOT the same as a zero balance.
     *
     * Default empty so alternate [BillingManager] implementations stay source-compatible.
     */
    val balances: StateFlow<Map<String, Int>> get() = MutableStateFlow(emptyMap())

    /**
     * Re-read [sku]'s balance from the server and publish it to [balances].
     *
     * @return the balance, or 0 when it cannot be read. 0 is the safe reading of "unknown" — it
     *   withholds a spend rather than granting one.
     */
    suspend fun refreshBalance(sku: String): Int = 0

    /**
     * Spend [quantity] of [sku] atomically, server-checked.
     *
     * [idempotencyKey] is REQUIRED and has no default (AR-011). A caller retrying after a timeout
     * must present the SAME key, so the server recognises the replay and returns the original
     * balance instead of charging twice. Only the caller knows which retry is the same logical
     * spend, which is why this cannot be defaulted here.
     *
     * @return the new balance on success. Insufficient funds is a [Result.failure], NOT an
     *   exception (AR-012) — a shopper short on currency is an expected outcome of a shop. Never
     *   grant the purchased thing on a failure.
     */
    suspend fun spend(sku: String, quantity: Int, idempotencyKey: String): Result<Int> =
        Result.failure(UnsupportedOperationException("balances not supported by this BillingManager"))

    // ─── One-time product ownership ──────────────────────────────────────────

    /**
     * Skus this user owns outright (non-consumable one-time unlocks).
     *
     * Server-confirmed only. A sku is absent until [refreshOwnership] gets a `true` back — never
     * optimistically on purchase return, because Play and StoreKit can both report success for a
     * transaction that later fails verification.
     */
    val ownedSkus: StateFlow<Set<String>> get() = MutableStateFlow(emptySet())

    /** Re-read ownership of [sku] from the server into [ownedSkus]. False when it cannot be read. */
    suspend fun refreshOwnership(sku: String): Boolean = false
}
