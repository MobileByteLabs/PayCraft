package com.mobilebytelabs.paycraft.model

import com.mobilebytelabs.paycraft.canary.green.GraceMapperCanary as GreenGraceCanary
import com.mobilebytelabs.paycraft.canary.red.GraceMapperCanary as RedGraceCanary
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pins the D6 canonical correctness rules: grace = active (with a billing issue),
 * billing-retry / on-hold = inactive. The GREEN canary maps grace → active and PASSES the
 * same isActive==true assertion the RED canary (grace → Expired) FAILS — proving the test
 * catches the grace = inactive defect class.
 */
class SubscriptionStateMapperTest {
    @Test
    fun grace_period_is_active_with_billing_issue() {
        assertTrue(SubscriptionState.InGracePeriod.isActive, "in_grace_period must be active (D6)")
        assertTrue(SubscriptionState.InGracePeriod.billingIssue, "grace flags a billing issue")
    }

    @Test
    fun billing_retry_and_hold_are_inactive() {
        assertFalse(SubscriptionState.OnBillingRetry.isActive, "on_billing_retry/on_hold must be inactive (D6)")
        assertTrue(SubscriptionState.OnBillingRetry.billingIssue, "billing-retry still flags a billing issue")
    }

    @Test
    fun trial_active_and_non_renewing_are_active() {
        assertTrue(SubscriptionState.Trial.isActive)
        assertTrue(SubscriptionState.Active.isActive)
        assertTrue(SubscriptionState.ActiveNonRenewing.isActive)
    }

    @Test
    fun expired_cancelled_refunded_paused_pending_are_inactive() {
        listOf(
            SubscriptionState.Expired,
            SubscriptionState.Cancelled,
            SubscriptionState.Refunded,
            SubscriptionState.Paused,
            SubscriptionState.Pending,
        ).forEach { assertFalse(it.isActive, "$it must be inactive") }
    }

    @Test
    fun green_canary_maps_grace_to_active_state() {
        val mapped = GreenGraceCanary.mapGrace()
        assertEquals(SubscriptionState.InGracePeriod, mapped, "green canary must map grace → InGracePeriod")
        assertTrue(mapped.isActive, "green canary grace mapping is active (D6) — this assertion PASSES")
    }

    @Test
    fun red_canary_grace_mapping_is_caught_as_inactive() {
        // The RED canary deliberately maps grace → Expired. The correctness assertion
        // `isActive == true` FAILS against it — which is exactly how the test catches the
        // grace = inactive defect class. We prove that failure would occur here.
        val mapped = RedGraceCanary.mapGrace()
        assertFalse(mapped.isActive, "red canary's grace→Expired mapping is (wrongly) inactive — the defect the D6 rule forbids")
    }

    @Test
    fun entitlement_gating_delegates_to_canonical_state() {
        val grace = Entitlement(
            userId = "u1",
            provider = "google",
            product = "premium_monthly",
            canonicalState = SubscriptionState.InGracePeriod,
            expiresAt = "2026-08-01T00:00:00Z",
            willRenew = true,
            inGraceUntil = "2026-07-25T00:00:00Z",
            latestEventTs = 1_753_000_000_000L,
        )
        assertTrue(grace.isActive, "grace entitlement is active (delegates to canonical state)")
        assertTrue(grace.hasBillingIssue, "grace entitlement flags a billing issue")

        val retry = grace.copy(canonicalState = SubscriptionState.OnBillingRetry)
        assertFalse(retry.isActive, "billing-retry entitlement is inactive")
        assertTrue(retry.hasBillingIssue, "billing-retry entitlement flags a billing issue")
    }
}
