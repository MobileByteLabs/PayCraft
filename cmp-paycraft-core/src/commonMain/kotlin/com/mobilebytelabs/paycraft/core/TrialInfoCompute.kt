package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.model.TrialInfo

/**
 * Pure function: derive a [TrialInfo] from a provider-emitted `trial_end`
 * ISO-8601 timestamp + a clock reading. Extracted as a top-level helper so it
 * can be unit-tested without spinning up a full [PayCraftBillingManager].
 *
 * Returns null if:
 *  - [trialEnd] is null or blank → no trial in this subscription
 *  - [trialEnd] is unparseable → fail conservative (UI sees "not in trial")
 *  - [trialEnd] is already past → subscription has rolled to active billing
 *
 * Otherwise returns [TrialInfo] with `daysRemaining = ceil((endMillis - now) / 1day)`,
 * clamped to `>= 0`.
 */
internal fun computeTrialInfo(trialEnd: String?, nowMillis: Long): TrialInfo? {
    if (trialEnd.isNullOrBlank()) return null
    val endMillis = SyncPolicy.parseExpiryToMillis(trialEnd) ?: return null
    if (endMillis <= nowMillis) return null
    val daysRemaining = ((endMillis - nowMillis + SyncPolicy.ONE_DAY - 1) / SyncPolicy.ONE_DAY).toInt()
    return TrialInfo(endsAt = trialEnd, daysRemaining = daysRemaining.coerceAtLeast(0))
}
