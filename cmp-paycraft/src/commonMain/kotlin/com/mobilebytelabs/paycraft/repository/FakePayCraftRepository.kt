/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.repository

import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.EntitlementSummary
import com.mobilebytelabs.paycraft.model.EntitlementTier
import com.mobilebytelabs.paycraft.model.SubscriptionState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlinx.coroutines.flow.MutableStateFlow
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
    /** What [restore] returns. Null → [restore] throws, so the unhappy path is testable too. */
    private val restoreResult: Entitlement? = null,
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
    val manageSubscriptionCalls: MutableList<String> = mutableListOf()

    /** Count of [refresh] calls, with the `force` flag each time. */
    val refreshCalls: MutableList<Boolean> = mutableListOf()

    override fun checkout(plan: BillingPlan, email: String?) {
        checkoutCalls += plan to email
    }

    override suspend fun restore(): Entitlement =
        restoreResult ?: error("FakePayCraftRepository: no restoreResult configured for this test")

    override fun manageSubscription(email: String) {
        manageSubscriptionCalls += email
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
}
