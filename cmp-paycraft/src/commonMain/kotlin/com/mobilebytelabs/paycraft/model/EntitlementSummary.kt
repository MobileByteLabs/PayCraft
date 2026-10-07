/*
 * Copyright 2026 MobileByteLabs
 *
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file,
 * You can obtain one at https://mozilla.org/MPL/2.0/.
 */
package com.mobilebytelabs.paycraft.model

/**
 * Entitlement tier — what a user is entitled to RIGHT NOW, independent of how they got there.
 *
 * Three values because that is what gating needs. Finer distinctions (which plan, which sub-tier,
 * when the trial ends) live on [EntitlementSummary] rather than multiplying this enum: an app
 * switching on tier wants three branches, and a tier per plan would force every app to handle plans
 * it does not sell.
 */
enum class EntitlementTier {
    /** No paid entitlement. */
    FREE,

    /** An active free trial — entitled to everything [PREMIUM] is, until [EntitlementSummary.trialEndsAt]. */
    TRIAL,

    /** A paid, active entitlement. */
    PREMIUM,
}

/**
 * The single value a consumer binds gating UI to.
 *
 * ## Why this exists
 *
 * `BillingState` is a sealed hierarchy describing WHERE A PURCHASE IS (`Loading`, `PaymentPending`,
 * `Error`, `DeviceConflict`…). That is the right shape for a checkout flow and the wrong shape for
 * gating: an app asking "can this user open the premium pack?" does not want seven branches, six of
 * which mean "not right now, for process reasons".
 *
 * So consumers built their own. Measured on `mbs/cappy` 2026-10-07: a local `SubscriptionState` data
 * class with a 3-value tier enum — the right shape, in the wrong place, and unable to represent
 * `PaymentPending` at all. Its 3-value enum would have collapsed a settling payment to FREE, showing
 * a paying user the paywall, which `BILLING_STATE_SEMANTICS.md` exists to prevent.
 *
 * This type is that shape, in the SDK, with the process states folded in deliberately:
 * `PaymentPending` keeps the PREVIOUS tier (a payment in flight does not revoke access), and
 * `Loading`/`Error` do the same. Only an explicitly Free entitlement reads FREE.
 *
 * ## Sub-tiers
 *
 * [roleIdentifier] carries the package ROLE (`SuiteConfig.roleForSku`), so an app with more than one
 * paid tier derives its own notion from TENANT CONFIGURATION rather than hardcoding product names.
 * cappy's "Warm Springs Guardian" is `roleIdentifier == "guardian"`; the SDK never learns that name.
 */
data class EntitlementSummary(
    val tier: EntitlementTier = EntitlementTier.FREE,

    /**
     * Package role of the entitled plan — the sub-tier key. Null when the tenant has no offerings or
     * the plan is not fronted by a package, in which case the app should treat it as untiered rather
     * than guessing.
     */
    val roleIdentifier: String? = null,

    /** SKU of the entitled plan, or null when nothing is entitled. */
    val planSku: String? = null,

    /** Provider-side subscription id, when one exists. Null for a trial with no purchase yet. */
    val entitlementId: String? = null,

    /** ISO-8601 instant the trial ends. Non-null only while [tier] is [EntitlementTier.TRIAL]. */
    val trialEndsAt: String? = null,

    /** Whether the entitlement renews at its period end. Meaningless when [tier] is FREE. */
    val willRenew: Boolean = true,
) {
    /**
     * THE gating predicate. True for both [EntitlementTier.PREMIUM] and [EntitlementTier.TRIAL] — a
     * trialing user is entitled to everything a paying one is, and gating them out is the most common
     * way a trial fails to convert.
     */
    val isPremium: Boolean get() = tier == EntitlementTier.PREMIUM || tier == EntitlementTier.TRIAL

    /** True only during a trial. Use for "trial ends in N days" copy, never for gating. */
    val isInTrial: Boolean get() = tier == EntitlementTier.TRIAL

    companion object {
        /** The not-entitled value. Also the safe pre-config default. */
        val Free: EntitlementSummary = EntitlementSummary(tier = EntitlementTier.FREE)

        /**
         * Fold a [BillingState] (+ its trial signal) into a gating summary.
         *
         * The process states are the point. `Loading`, `Error` and `PaymentPending` all PRESERVE the
         * previous tier instead of reading FREE: a config fetch in flight, a transient error, or a
         * payment settling are none of them evidence that the user lost access, and treating them as
         * such is what shows the paywall to someone who already paid.
         *
         * @param previous the last known summary, used to hold tier across a process state.
         */
        fun from(
            state: BillingState,
            trialEndsAt: String? = null,
            roleIdentifier: String? = null,
            previous: EntitlementSummary = Free,
        ): EntitlementSummary = when (state) {
            is BillingState.Premium -> EntitlementSummary(
                tier = if (state.trial != null) EntitlementTier.TRIAL else EntitlementTier.PREMIUM,
                roleIdentifier = roleIdentifier ?: previous.roleIdentifier,
                planSku = state.status.plan ?: previous.planSku,
                // Prefer the instant the STATE carries (TrialInfo.endsAt) over the caller's hint:
                // it is the server's own trial_end, so the two cannot disagree.
                trialEndsAt = state.trial?.endsAt ?: trialEndsAt ?: previous.trialEndsAt,
                willRenew = state.status.willRenew,
            )
            is BillingState.Free -> Free
            // Process states — hold the previous tier. See the note above.
            is BillingState.Loading,
            is BillingState.Error,
            is BillingState.PaymentPending,
            -> previous
            // Device-flow states are not entitlement statements either; the entitlement they resolve
            // to arrives as a subsequent Premium/Free emission.
            else -> previous
        }
    }
}
