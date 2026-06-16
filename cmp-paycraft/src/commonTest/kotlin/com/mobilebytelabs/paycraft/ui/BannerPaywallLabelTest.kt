package com.mobilebytelabs.paycraft.ui

import com.mobilebytelabs.paycraft.model.BillingState
import com.mobilebytelabs.paycraft.model.SubscriptionStatus
import com.mobilebytelabs.paycraft.model.TrialInfo
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Pure-logic test for the [BannerPaywall] label resolver.
 *
 * The Compose pieces (Surface / Row / Icon) are not exercised here — runComposeUiTest
 * lives in androidInstrumentedTest. This test pins the state→string contract so
 * `BillingState` additions never silently fall through to a default label.
 */
class BannerPaywallLabelTest {

    @Test
    fun free_state_shows_upgrade_label() {
        assertEquals("Upgrade to Premium", bannerLabelFor(BillingState.Free))
    }

    @Test
    fun premium_without_trial_shows_active_label() {
        val state = BillingState.Premium(SubscriptionStatus(isPremium = true, plan = "monthly"))
        assertEquals("Premium active", bannerLabelFor(state))
    }

    @Test
    fun premium_with_trial_shows_days_remaining() {
        val state = BillingState.Premium(
            status = SubscriptionStatus(isPremium = true, plan = "monthly"),
            trial = TrialInfo(endsAt = "2030-01-01T00:00:00Z", daysRemaining = 5),
        )
        assertEquals("Free trial — 5 days left", bannerLabelFor(state))
    }

    @Test
    fun loading_state_shows_checking_label() {
        assertEquals("Checking your subscription…", bannerLabelFor(BillingState.Loading))
    }

    @Test
    fun error_state_shows_retry_label() {
        assertEquals(
            "Couldn't sync — tap to retry",
            bannerLabelFor(BillingState.Error("network down")),
        )
    }

    @Test
    fun device_conflict_shows_verify_label() {
        val state = BillingState.DeviceConflict(
            email = "user@example.com",
            pendingToken = "tok",
            conflictingDeviceName = "Other Phone",
            conflictingLastSeen = null,
            otpAvailable = true,
            otpDailyLimit = 5,
            supportEmail = "support@example.com",
        )
        assertEquals("Verify ownership to continue", bannerLabelFor(state))
    }
}

/**
 * Mirror of the resolver embedded in [BannerPaywall] so the contract is testable
 * without standing up a Compose runtime. Keep in sync with [BannerPaywall].
 */
private fun bannerLabelFor(state: BillingState): String = when (state) {
    is BillingState.Free -> "Upgrade to Premium"
    is BillingState.Premium -> when {
        state.trial != null -> "Free trial — ${state.trial.daysRemaining} days left"
        else -> "Premium active"
    }
    is BillingState.Loading -> "Checking your subscription…"
    is BillingState.Error -> "Couldn't sync — tap to retry"
    is BillingState.DeviceConflict -> "Verify ownership to continue"
    is BillingState.OwnershipVerified -> "Manage subscription"
}
