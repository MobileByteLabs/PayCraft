package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The entitlement derivation shared by every gate and guard.
 *
 * These assertions used to live in [PayCraftPaywallGuardTest], driven through a `billingManager`
 * parameter on a DEPRECATED composable. That parameter is gone — it was the last thing keeping
 * `BillingManager` a public type — and the derivation moved into `gateVerdictOf`, which both the
 * live gates and the deprecated guards now share. So the coverage moved with it, and got cheaper:
 * no Compose runtime, no Koin graph, no global-state ordering between tests.
 *
 * Every case here is a way to hand paid content to someone who has not paid, or to lock out someone
 * who has. Neither shows up as a crash — only as revenue or a support ticket.
 */
class GateVerdictTest {

    private val premiumState = BillingState.Premium(SubscriptionStatus(isPremium = true))

    @Test
    fun aPremiumUserIsEntitled() {
        assertTrue(gateVerdictOf(isPremium = true, isAdFree = false, billingState = premiumState).entitled)
    }

    @Test
    fun aFreeUserIsNotEntitled() {
        assertFalse(gateVerdictOf(isPremium = false, isAdFree = false, billingState = BillingState.Free).entitled)
    }

    @Test
    fun aBuyerWhosePaymentHasNotClearedKeepsAccess() {
        // PaymentPending is NOT a BillingState.Premium instance, so a gate that pattern-matches on
        // billingState locks out someone the store has already taken money from. isPremium is the
        // SDK's one authoritative signal, and it is what this reads.
        val verdict = gateVerdictOf(
            isPremium = true,
            isAdFree = false,
            billingState = BillingState.PaymentPending(productId = "annual"),
        )
        assertTrue(verdict.entitled)
        assertFalse(verdict.resolving)
    }

    @Test
    fun anOfflinePremiumUserInGraceKeepsAccess() {
        // Offline grace reports isPremium from cache. Gating on a live state would revoke a paying
        // customer's access the moment their train entered a tunnel.
        assertTrue(gateVerdictOf(isPremium = true, isAdFree = false, billingState = BillingState.Free).entitled)
    }

    @Test
    fun aHostPushedAdFreeCohortIsEntitled() {
        // PayCraft.isAdFree (AC-12, AdFreeEntitlement) is the SDK's OWN ad-gating flow. A host that
        // grants ad-free for its own reason — a promo, a grandfathered tier — must not then have
        // this gate disagree with every other ad check in the app.
        assertTrue(gateVerdictOf(isPremium = false, isAdFree = true, billingState = BillingState.Free).entitled)
    }

    @Test
    fun loadingIsResolvingRatherThanNotEntitled() {
        // "We do not know yet" is not "not premium". Folding Loading into not-entitled gave a paying
        // customer a paywall flash on every cold start.
        val verdict = gateVerdictOf(isPremium = false, isAdFree = false, billingState = BillingState.Loading)
        assertTrue(verdict.resolving)
        assertFalse(verdict.entitled)
    }

    @Test
    fun entitlementWinsOverResolving() {
        // A warm cache can report premium while a refresh is in flight. Every caller checks
        // `entitled` before `resolving` for exactly this case — an entitled user must not be made
        // to wait behind a spinner — so both flags being true at once is expected, not a conflict.
        val verdict = gateVerdictOf(isPremium = true, isAdFree = false, billingState = BillingState.Loading)
        assertTrue(verdict.entitled)
        assertTrue(verdict.resolving)
    }
}
