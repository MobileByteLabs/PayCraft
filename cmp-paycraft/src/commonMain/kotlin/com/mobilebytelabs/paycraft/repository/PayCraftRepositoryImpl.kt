/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.repository

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.config.CouponDto
import com.mobilebytelabs.paycraft.config.roleForSku
import com.mobilebytelabs.paycraft.core.BillingManager
import com.mobilebytelabs.paycraft.core.EntitlementRepository
import com.mobilebytelabs.paycraft.core.EntitlementSnapshot
import com.mobilebytelabs.paycraft.core.PaywallPresentation
import com.mobilebytelabs.paycraft.core.SubscriptionActivated
import com.mobilebytelabs.paycraft.core.TrialSnapshot
import com.mobilebytelabs.paycraft.model.BillingPlan
import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.model.EntitlementSummary
import com.mobilebytelabs.paycraft.model.OAuthProvider
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.network.CouponClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.scan
import kotlinx.coroutines.flow.stateIn

/**
 * Composition, not logic. Every member below forwards to a surface this SDK already owns; this class
 * holds no entitlement state of its own, so there is exactly one source of truth per signal and no
 * second cache to go stale.
 *
 * `internal` deliberately: consumers resolve [PayCraftRepository] from Koin and must not name the
 * implementation. That is what keeps the facade substitutable by [FakePayCraftRepository] in tests.
 *
 * @param billing the headless surface — owns [isPremium], [billingState] and refresh.
 * @param entitlements the Store5 layer — owns restore. Composed here precisely so a CONSUMER never
 *   has to: its API threads an `appUserId` and speaks `StoreReadResponse`, which is the plumbing this
 *   facade exists to hide.
 * @param scope drives the [plans] projection only. The SDK's own `applicationScope` is private, so
 *   rather than widening that for one flow this single (app-lifetime, Koin-scoped) object owns a
 *   SupervisorJob of its own — a child failure cannot take the app down with it.
 */
internal class PayCraftRepositoryImpl(
    private val billing: BillingManager,
    private val entitlements: EntitlementRepository,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) : PayCraftRepository {

    override val isPremium: StateFlow<Boolean> get() = billing.isPremium
    override val balances: StateFlow<Map<String, Int>> get() = billing.balances
    override val billingState: StateFlow<BillingState> get() = billing.billingState
    override val subscriptionStatus: StateFlow<SubscriptionStatus> get() = billing.subscriptionStatus
    override val isInTrial: StateFlow<Boolean> get() = billing.isInTrial

    /**
     * Projected from the config flow rather than read off `PayCraft.plans`.
     *
     * `PayCraft.plans` is a plain `List` snapshot, so a paywall composed before the first `/config`
     * lands would read an empty list once and never recompose. `suiteConfigFlow` is used purely as a
     * CHANGE TRIGGER and the value is re-read from `PayCraft.plans` — deliberately NOT mapped out of
     * `SuiteConfig` here. `SuiteConfig` carries `products: List<ProductDto>`, and turning those into
     * `BillingPlan`s is a builder the SDK already owns (it is what decides `id` vs `sku`, the
     * distinction that once cost every paywall-built plan its payment links). Re-deriving it here
     * would be a second copy of that mapping, free to drift.
     *
     * `SharingStarted.Eagerly` because the paywall is frequently the FIRST consumer to subscribe:
     * `WhileSubscribed` would drop the value between a prefetch and the paywall opening, putting
     * back the skeleton `prefetchProducts()` exists to avoid.
     */
    override val plans: StateFlow<List<BillingPlan>> =
        PayCraft.suiteConfigFlow
            .map { PayCraft.plans }
            .stateIn(scope, SharingStarted.Eagerly, PayCraft.plans)

    /**
     * Derived, never stored. `scan` carries the PREVIOUS summary into each fold so a process state
     * (`Loading` / `Error` / `PaymentPending`) can hold the prior tier — which is the whole reason
     * this type exists. A plain `map` would have no previous value to hold, and a settling payment
     * would read FREE and show the paywall to someone who just paid.
     *
     * The role is resolved per emission from the entitled plan's sku, so a dashboard rename of a
     * package role reaches the app on the next config without an app release.
     */
    override val entitlement: StateFlow<EntitlementSummary> =
        combine(billing.billingState, PayCraft.suiteConfigFlow) { state, config ->
            state to config
        }.scan(EntitlementSummary.Free) { previous, (state, config) ->
            val sku = (state as? BillingState.Premium)?.status?.plan
            EntitlementSummary.from(
                state = state,
                roleIdentifier = sku?.let { config?.roleForSku(it) },
                previous = previous,
            )
        }.stateIn(scope, SharingStarted.Eagerly, EntitlementSummary.Free)

    /** Fire-and-observe; lane resolution (native vs web) belongs to the SDK and is not re-decided. */
    override fun checkout(plan: BillingPlan, email: String?) = PayCraft.checkout(plan, email)

    /**
     * `appUserId` resolved the same way the rest of the SDK resolves it — `email ?: deviceId`
     * (`PayCraft.kt`'s own rule). Duplicating that rule here would be a second place for it to drift,
     * so it reads the email the billing manager already holds.
     */
    override suspend fun restore(): Entitlement {
        val appUserId = billing.userEmail.value
            ?.trim()
            ?.lowercase()
            ?.ifBlank { null }
            ?: PayCraft.deviceId
        return entitlements.restore(appUserId)
    }

    override fun manageSubscription(email: String?) = PayCraft.manageSubscription(email)

    override fun manageSubscriptionUrl(email: String?): String? = PayCraft.manageSubscriptionUrl(email)

    override fun refresh(force: Boolean) = billing.refreshStatus(force)

    // Read through, never mirrored: AdFreeEntitlement owns this and a copy here could disagree.
    override val isAdFree: StateFlow<Boolean> get() = PayCraft.isAdFree

    override suspend fun applyCoupon(planId: String, code: String): CouponClient.Result =
        PayCraft.applyCoupon(planId, code)

    override fun setAppliedCoupon(planId: String, coupon: CouponDto?) = PayCraft.setAppliedCoupon(planId, coupon)

    override val paywallPresentation: StateFlow<PaywallPresentation> get() = PayCraft.paywallPresentation

    override fun presentPaywall() = PayCraft.presentPaywall()

    override fun presentPaywallIfNeeded(entitlement: String?) = PayCraft.presentPaywallIfNeeded(entitlement)

    override fun dismissPaywall() = PayCraft.dismissPaywall()

    override fun onAppOpen(entitlement: EntitlementSnapshot, trial: TrialSnapshot) =
        PayCraft.onAppOpen(entitlement, trial)

    override val userEmail: StateFlow<String?> get() = billing.userEmail

    override fun logIn(email: String) = billing.logIn(email)

    override fun logOut() = billing.logOut()

    override suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String) =
        billing.loginWithOAuth(provider, idToken)

    override suspend fun checkTrialEligibility(): Boolean = billing.checkTrialEligibility()

    override val subscriptionActivated: SharedFlow<SubscriptionActivated> get() = billing.subscriptionActivated

    override suspend fun confirmDeviceTransfer() = billing.confirmDeviceTransfer()

    // `revokeCurrentDevice`, NOT `transferToDevice`. BillingManager has both, and only this one
    // belongs on a consumer facade: transferToDevice is documented there as "internal — called by
    // confirmDeviceTransfer", so exposing it would hand a host the half-step that skips the
    // deactivation of the other device.
    override suspend fun revokeCurrentDevice() = billing.revokeCurrentDevice()

    override suspend fun refreshBalance(sku: String): Int = billing.refreshBalance(sku)

    override suspend fun spend(sku: String, quantity: Int, idempotencyKey: String): Result<Int> =
        billing.spend(sku, quantity, idempotencyKey)
}
