/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The reason this type exists is the process states, so that is what these assert.
 *
 * `BillingState` is a 7-variant sealed hierarchy describing WHERE A PURCHASE IS. Gating needs a
 * tier. The naive fold maps anything that is not `Premium` to FREE — which revokes access during a
 * config fetch, a transient error, or a payment settling asynchronously. That last one is the
 * documented trap: `BILLING_STATE_SEMANTICS.md` says `PaymentPending` is NOT a failure, and cappy's
 * local 3-value enum had no way to represent it at all.
 */
class EntitlementSummaryTest {

    private val premiumStatus = SubscriptionStatus(isPremium = true, plan = "plus_monthly", willRenew = true)
    private val premium = EntitlementSummary.from(BillingState.Premium(premiumStatus), roleIdentifier = "plus")

    @Test
    fun premium_state_yields_premium_tier() {
        assertEquals(EntitlementTier.PREMIUM, premium.tier)
        assertTrue(premium.isPremium)
        assertFalse(premium.isInTrial)
        assertEquals("plus", premium.roleIdentifier)
        assertEquals("plus_monthly", premium.planSku)
    }

    @Test
    fun a_trial_is_premium_but_also_in_trial() {
        val s = EntitlementSummary.from(
            BillingState.Premium(premiumStatus, TrialInfo(endsAt = "2026-10-14T00:00:00Z", daysRemaining = 7)),
        )
        assertEquals(EntitlementTier.TRIAL, s.tier)
        // Gating a trialing user out is the most common way a trial fails to convert.
        assertTrue(s.isPremium, "a trialing user must be entitled to everything a paying one is")
        assertTrue(s.isInTrial)
        // The trial end comes from the STATE's own TrialInfo, not a caller hint.
        assertEquals("2026-10-14T00:00:00Z", s.trialEndsAt)
    }

    @Test
    fun payment_pending_PRESERVES_the_previous_tier() {
        val s = EntitlementSummary.from(BillingState.PaymentPending("plus_monthly"), previous = premium)
        assertEquals(EntitlementTier.PREMIUM, s.tier)
        assertTrue(s.isPremium, "a settling payment must not show the paywall to someone who paid")
    }

    @Test
    fun loading_and_error_also_preserve_tier() {
        assertTrue(EntitlementSummary.from(BillingState.Loading, previous = premium).isPremium)
        assertTrue(EntitlementSummary.from(BillingState.Error("boom"), previous = premium).isPremium)
        // …and from a FREE baseline they stay free rather than inventing access.
        assertFalse(EntitlementSummary.from(BillingState.Loading).isPremium)
    }

    @Test
    fun only_an_explicit_Free_state_revokes() {
        val s = EntitlementSummary.from(BillingState.Free, previous = premium)
        assertEquals(EntitlementTier.FREE, s.tier)
        assertFalse(s.isPremium)
        assertNull(s.planSku)
        assertNull(s.roleIdentifier)
    }

    @Test
    fun the_default_is_free_not_premium() {
        // A pre-config default of PREMIUM would hand out access the server never granted.
        assertEquals(EntitlementTier.FREE, EntitlementSummary().tier)
        assertFalse(EntitlementSummary.Free.isPremium)
    }
}
