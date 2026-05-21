package com.mobilebytelabs.paycraft.model

/**
 * Trial-period snapshot, attached to [BillingState.Premium.trial] when the
 * underlying subscription is in its free-trial window.
 *
 * [endsAt] mirrors the provider-emitted `trial_end` (ISO-8601 UTC, same format
 * convention as [SubscriptionStatus.expiresAt]).
 * [daysRemaining] is computed at construction time (ceil((endsAt - now)/1day),
 * clamped to ≥ 0). It is a snapshot, not a live counter — callers that need a
 * fresher value should call [com.mobilebytelabs.paycraft.core.BillingManager.refreshStatus].
 */
data class TrialInfo(
    val endsAt: String,
    val daysRemaining: Int,
)
