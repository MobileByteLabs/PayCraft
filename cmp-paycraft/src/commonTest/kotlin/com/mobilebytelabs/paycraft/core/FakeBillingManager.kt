package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * In-memory [BillingManager] for Compose UI tests. Performs no network calls.
 *
 * Shared, rather than a `private class` per test file: three test files had grown their own copy, so
 * a change to [BillingManager] meant three edits, and the copies had already drifted apart in what
 * they could express.
 *
 * ## [premium] is independent of [billingState], on purpose
 *
 * The per-file copies derived it — `isPremium = initialState is BillingState.Premium` — which makes
 * the two agree BY CONSTRUCTION and so cannot reproduce the cases where the real SDK has them
 * disagree. Those cases are the interesting ones:
 *
 *  - `PaymentPending` — the store took the money, the webhook has not landed. `isPremium` is true.
 *  - offline grace — last-known-good entitlement served while unreachable.
 *  - `OwnershipVerified` — restore matched an entitlement on another account.
 *
 * A guard that gates on `billingState is Premium` locks all three out, and a fake that derives one
 * from the other will never catch it. Default behaviour is unchanged for existing callers: omit
 * [premium] and it falls back to the derived value.
 */
class FakeBillingManager(
    billingState: BillingState = BillingState.Free,
    premium: Boolean = billingState is BillingState.Premium,
) : BillingManager {

    private val _billingState = MutableStateFlow(billingState)
    override val billingState: StateFlow<BillingState> = _billingState

    private val _isPremium = MutableStateFlow(premium)
    override val isPremium: StateFlow<Boolean> = _isPremium

    private val _subscriptionStatus = MutableStateFlow(SubscriptionStatus())
    override val subscriptionStatus: StateFlow<SubscriptionStatus> = _subscriptionStatus

    private val _userEmail = MutableStateFlow<String?>(null)
    override val userEmail: StateFlow<String?> = _userEmail

    private val _subscriptionActivated = MutableSharedFlow<SubscriptionActivated>(replay = 0)
    override val subscriptionActivated: SharedFlow<SubscriptionActivated> = _subscriptionActivated

    private val _isInTrial = MutableStateFlow(false)
    override val isInTrial: StateFlow<Boolean> = _isInTrial

    private val _trialEndsAt = MutableStateFlow<String?>(null)
    override val trialEndsAt: StateFlow<String?> = _trialEndsAt

    var registerAndLoginCallCount = 0
    var lastRegisteredEmail: String? = null

    override fun registerAndLogin(email: String) {
        registerAndLoginCallCount++
        lastRegisteredEmail = email
    }

    override fun logIn(email: String) = registerAndLogin(email)

    override fun purchaseViaPlayBilling(plan: BillingPlan, email: String?) { /* no-op in tests */ }
    override fun purchaseViaStoreKit(plan: BillingPlan, email: String?) { /* no-op in tests */ }

    override suspend fun checkTrialEligibility(): Boolean = true

    override fun refreshStatus(force: Boolean) { /* no-op in tests */ }

    override suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String) { /* no-op */ }

    override suspend fun confirmDeviceTransfer() { /* no-op */ }

    override suspend fun transferToDevice() { /* no-op */ }

    override suspend fun revokeCurrentDevice() { /* no-op */ }

    override fun logOut() { /* no-op */ }

    /** Test-only: drive the billing state to simulate a server response. */
    fun emitState(state: BillingState) {
        _billingState.value = state
    }

    /** Test-only: drive the gating signal independently, to assert a collector reacted. */
    fun emitPremium(value: Boolean) {
        _isPremium.value = value
    }
}
