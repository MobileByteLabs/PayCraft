/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.repository

import com.mobilebytelabs.paycraft.config.CouponDto
import com.mobilebytelabs.paycraft.core.EntitlementSnapshot
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import com.mobilebytelabs.paycraft.core.SubscriptionActivated
import com.mobilebytelabs.paycraft.core.TrialSnapshot
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.EntitlementSummary
import com.mobilebytelabs.paycraft.model.EntitlementTier
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.network.CouponClient
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * In-memory [PayCraftRepository] for consumer unit tests and `@Preview`s.
 *
 * ## Why this ships in the MAIN artifact, not a test fixture
 *
 * The framework rule this facade replaced required each consumer to hand-write a repository, and the
 * stated reason was testability: an app-owned interface could be faked. Removing that wrapper is only
 * honest if testability moves WITH it. A fake behind `testImplementation` would not reach a
 * consumer's `commonTest` without extra wiring, so it lives here — the cost is a handful of KB in the
 * production artifact, which is cheaper than every consumer keeping a 200-line wrapper to stay
 * testable.
 *
 * ## Use
 *
 * ```kotlin
 * val repo = FakePayCraftRepository(premium = true)
 * // …exercise the ViewModel…
 * repo.setPremium(false)   // flip mid-test; collectors see it
 * ```
 *
 * [checkout] and [manageSubscription] record their calls rather than performing them, so a test can
 * assert that a tap reached the SDK without opening anything.
 */
class FakePayCraftRepository(
    premium: Boolean = false,
    billingState: BillingState = if (premium) {
        BillingState.Premium(
            SubscriptionStatus(isPremium = true),
        )
    } else {
        BillingState.Free
    },
    subscriptionStatus: SubscriptionStatus = SubscriptionStatus(isPremium = premium),
    inTrial: Boolean = false,
    entitlement: EntitlementSummary = EntitlementSummary(
        tier = if (inTrial) {
            EntitlementTier.TRIAL
        } else if (premium) {
            EntitlementTier.PREMIUM
        } else {
            EntitlementTier.FREE
        },
    ),
    plans: List<BillingPlan> = emptyList(),
    /**
     * What [restore] returns. Null → [restore] throws, so the unhappy path is testable too.
     *
     * A `var`, and settable mid-run via [setRestoreResult], because the retry wiring a host screen
     * builds around restore (fail → show error → user taps Retry → succeed) cannot be exercised by
     * a fake whose outcome is fixed at construction. Same reasoning as the state mutators below.
     */
    private var restoreResult: Entitlement? = null,
) : PayCraftRepository {

    private val _isPremium = MutableStateFlow(premium)
    private val _billingState = MutableStateFlow(billingState)
    private val _subscriptionStatus = MutableStateFlow(subscriptionStatus)
    private val _isInTrial = MutableStateFlow(inTrial)
    private val _plans = MutableStateFlow(plans)
    private val _entitlement = MutableStateFlow(entitlement)

    override val isPremium: StateFlow<Boolean> = _isPremium.asStateFlow()
    override val billingState: StateFlow<BillingState> = _billingState.asStateFlow()
    override val subscriptionStatus: StateFlow<SubscriptionStatus> = _subscriptionStatus.asStateFlow()
    override val isInTrial: StateFlow<Boolean> = _isInTrial.asStateFlow()
    override val plans: StateFlow<List<BillingPlan>> = _plans.asStateFlow()
    override val entitlement: StateFlow<EntitlementSummary> = _entitlement.asStateFlow()

    /** Every [checkout] call, in order — assert a tap reached the SDK. */
    val checkoutCalls: MutableList<Pair<BillingPlan, String?>> = mutableListOf()

    /** Every [manageSubscription] call, in order. */
    val manageSubscriptionCalls: MutableList<String?> = mutableListOf()

    /** Count of [refresh] calls, with the `force` flag each time. */
    val refreshCalls: MutableList<Boolean> = mutableListOf()

    override fun checkout(plan: BillingPlan, email: String?) {
        checkoutCalls += plan to email
    }

    /** Count of [restore] calls — assert a Retry actually re-fired it, not just re-rendered. */
    var restoreCallCount: Int = 0
        private set

    override suspend fun restore(): Entitlement {
        restoreCallCount++
        return restoreResult
            ?: error("FakePayCraftRepository: no restoreResult configured for this test")
    }

    override fun manageSubscription(email: String?) {
        manageSubscriptionCalls += email
    }

    /** The URL a test wants [manageSubscriptionUrl] to report. Null models "nowhere to send them". */
    var manageSubscriptionUrlResult: String? = null
    override fun manageSubscriptionUrl(email: String?): String? = manageSubscriptionUrlResult

    /** Ad-free is a SEPARATE grant from premium (AC-12), so a test must be able to set it alone. */
    val adFreeFlow = MutableStateFlow(false)
    override val isAdFree: StateFlow<Boolean> get() = adFreeFlow

    /** Coupon verdict a test wants returned; the calls are recorded for assertion. */
    var couponResult: CouponClient.Result? = null
    val applyCouponCalls = mutableListOf<Pair<String, String>>()
    override suspend fun applyCoupon(planId: String, code: String): CouponClient.Result {
        applyCouponCalls += planId to code
        return couponResult ?: error("FakePayCraftRepository.couponResult was not set for this test")
    }

    val setAppliedCouponCalls = mutableListOf<Pair<String, CouponDto?>>()
    override fun setAppliedCoupon(planId: String, coupon: CouponDto?) {
        setAppliedCouponCalls += planId to coupon
    }

    override fun refresh(force: Boolean) {
        refreshCalls += force
    }

    // ── Test-side mutators. Separate from the constructor so a test can flip state MID-run and
    // assert the collector reacted — the thing a gating test actually needs to prove.

    fun setPremium(value: Boolean) {
        _isPremium.value = value
        _subscriptionStatus.value = SubscriptionStatus(isPremium = value)
        _billingState.value =
            if (value) BillingState.Premium(SubscriptionStatus(isPremium = true)) else BillingState.Free
        // Keep the summary coherent: a fake whose isPremium and entitlement.tier could disagree would
        // let a gating test pass against a state the real impl can never produce.
        _entitlement.value = _entitlement.value.copy(
            tier = if (value) EntitlementTier.PREMIUM else EntitlementTier.FREE,
        )
    }

    fun setBillingState(value: BillingState) {
        _billingState.value = value
    }

    /**
     * Change what the NEXT [restore] does. `null` makes it throw.
     *
     * The retry path needs this: a host shows an error on a failed restore and re-fires it when the
     * user taps Retry, and proving the recovery means the second call must be able to succeed where
     * the first failed.
     */
    fun setRestoreResult(value: Entitlement?) {
        restoreResult = value
    }

    fun setInTrial(value: Boolean) {
        _isInTrial.value = value
    }

    fun setPlans(value: List<BillingPlan>) {
        _plans.value = value
    }

    /** Set the gating summary directly — for a test that needs a sub-tier role or a trial end. */
    fun setEntitlement(value: EntitlementSummary) {
        _entitlement.value = value
    }

    companion object {
        /** A minimal active entitlement, for tests that only need [restore] to succeed. */
        fun activeEntitlement(userId: String = "test-user"): Entitlement = Entitlement(
            userId = userId,
            provider = "stripe",
            product = "test_monthly",
            canonicalState = SubscriptionState.Active,
            expiresAt = null,
            willRenew = true,
            latestEventTs = 0L,
        )
    }

    /** Drives the paywall branches without a Koin graph or a real presentation state machine. */
    val paywallPresentationFlow = MutableStateFlow<PaywallPresentation>(PaywallPresentation.Hidden)
    override val paywallPresentation: StateFlow<PaywallPresentation> get() = paywallPresentationFlow

    var presentPaywallCalls = 0
    override fun presentPaywall() {
        presentPaywallCalls++
    }

    val presentPaywallIfNeededCalls = mutableListOf<String?>()
    override fun presentPaywallIfNeeded(entitlement: String?) {
        presentPaywallIfNeededCalls += entitlement
    }

    var dismissPaywallCalls = 0
    override fun dismissPaywall() {
        dismissPaywallCalls++
    }

    val onAppOpenCalls = mutableListOf<Pair<EntitlementSnapshot, TrialSnapshot>>()
    override fun onAppOpen(entitlement: EntitlementSnapshot, trial: TrialSnapshot) {
        onAppOpenCalls += entitlement to trial
    }

    // ── Identity ─────────────────────────────────────────────────────────────────────────────────

    val userEmailFlow = MutableStateFlow<String?>(null)
    override val userEmail: StateFlow<String?> get() = userEmailFlow

    /** Recorded AND applied: a test asserting re-binding needs userEmail to actually change. */
    val logInCalls = mutableListOf<String>()
    override fun logIn(email: String) {
        logInCalls += email
        userEmailFlow.value = email
    }

    var logOutCalls = 0
    override fun logOut() {
        logOutCalls++
        userEmailFlow.value = null
        // Sign-out drops the entitlement with the identity — a fake that kept premium would let a
        // test pass while the real app showed the next user the previous user's state.
        setPremium(false)
    }

    val loginWithOAuthCalls = mutableListOf<Pair<OAuthProvider, String>>()
    override suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String) {
        loginWithOAuthCalls += provider to idToken
    }

    /** What [checkTrialEligibility] should answer. Defaults to eligible, the commonest case. */
    var trialEligible: Boolean = true
    override suspend fun checkTrialEligibility(): Boolean = trialEligible

    val subscriptionActivatedFlow = MutableSharedFlow<SubscriptionActivated>(replay = 1)
    override val subscriptionActivated: SharedFlow<SubscriptionActivated> get() = subscriptionActivatedFlow
}
