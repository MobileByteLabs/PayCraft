package com.mobilebytelabs.paycraft.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Pins the additive canonical ↔ legacy [SubscriptionStatus] bridge (no rewiring of the legacy surface). */
class SubscriptionStateBridgeTest {
    @Test
    fun premium_renewing_status_maps_to_active() {
        val status = SubscriptionStatus(isPremium = true, willRenew = true)
        assertEquals(SubscriptionState.Active, status.toCanonicalState())
    }

    @Test
    fun premium_non_renewing_status_maps_to_active_non_renewing() {
        val status = SubscriptionStatus(isPremium = true, willRenew = false)
        assertEquals(SubscriptionState.ActiveNonRenewing, status.toCanonicalState())
    }

    @Test
    fun non_premium_status_maps_to_expired() {
        val status = SubscriptionStatus(isPremium = false)
        assertEquals(SubscriptionState.Expired, status.toCanonicalState())
    }

    @Test
    fun grace_state_projects_to_premium_snapshot_D6() {
        // Grace is active (D6), so the legacy premium snapshot must stay isPremium=true.
        val status = SubscriptionState.InGracePeriod.toSubscriptionStatus(provider = "stripe")
        assertTrue(status.isPremium, "grace projects to premium (D6 grace = active)")
        assertEquals("stripe", status.provider)
    }

    @Test
    fun retry_state_projects_to_non_premium_snapshot() {
        assertFalse(SubscriptionState.OnBillingRetry.toSubscriptionStatus().isPremium)
    }

    @Test
    fun entitlement_projects_product_and_provider_onto_status() {
        val ent = Entitlement(
            userId = "u1",
            provider = "razorpay",
            product = "pro_annual",
            canonicalState = SubscriptionState.ActiveNonRenewing,
            expiresAt = "2027-01-01T00:00:00Z",
            willRenew = false,
            latestEventTs = 1_753_000_000_000L,
        )
        val status = ent.toSubscriptionStatus(email = "a@b.co")
        assertTrue(status.isPremium)
        assertEquals("pro_annual", status.plan)
        assertEquals("razorpay", status.provider)
        assertEquals("a@b.co", status.email)
        assertFalse(status.willRenew)
    }
}
