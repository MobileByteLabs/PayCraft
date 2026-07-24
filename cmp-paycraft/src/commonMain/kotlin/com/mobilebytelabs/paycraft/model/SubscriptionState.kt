package com.mobilebytelabs.paycraft.model

/**
 * Canonical, provider-agnostic subscription state (GOAL D6).
 *
 * This is the single normalization target every provider adapter (Phase 2/3) and the
 * reconciliation engine / Store5 cache (Phase 2/4) reconcile into, so no adapter can
 * re-derive the gating rules differently. It is ORTHOGONAL to the legacy
 * [SubscriptionStatus] (the premium snapshot) and [BillingState] (the consumer-UI
 * state) — see [toSubscriptionStatus] / [SubscriptionStatus.toCanonicalState] for the
 * bridge that keeps the two layers in sync instead of duplicating them.
 *
 * The one correctness rule that unifies all 11 web providers + native StoreKit2/Play:
 *  - grace period counts as ACTIVE (the user keeps access while the provider retries billing);
 *  - billing-retry / on-hold counts as INACTIVE (access is already suspended).
 * Both carry [billingIssue] = true so the paywall can surface a "fix your payment" affordance.
 */
sealed interface SubscriptionState {
    /** Gating truth: does the user currently have entitlement access? */
    val isActive: Boolean

    /** True when the provider is signalling a payment problem the user should resolve. */
    val billingIssue: Boolean

    /** Free-trial window — full access, no payment problem. */
    data object Trial : SubscriptionState {
        override val isActive = true
        override val billingIssue = false
    }

    /** Paid and auto-renewing — the steady-state active subscription. */
    data object Active : SubscriptionState {
        override val isActive = true
        override val billingIssue = false
    }

    /** Active but auto-renew is off — still entitled until [Entitlement.expiresAt]. */
    data object ActiveNonRenewing : SubscriptionState {
        override val isActive = true
        override val billingIssue = false
    }

    /** Payment failed but the provider grace window keeps access ALIVE (D6: grace = active). */
    data object InGracePeriod : SubscriptionState {
        override val isActive = true
        override val billingIssue = true
    }

    /**
     * Provider is retrying a failed charge (Play `on_hold` / Apple billing-retry) —
     * access SUSPENDED (D6: inactive).
     */
    data object OnBillingRetry : SubscriptionState {
        override val isActive = false
        override val billingIssue = true
    }

    /** User-paused subscription (Play pause) — inactive, no billing problem. */
    data object Paused : SubscriptionState {
        override val isActive = false
        override val billingIssue = false
    }

    /** Term ended without renewal — inactive. */
    data object Expired : SubscriptionState {
        override val isActive = false
        override val billingIssue = false
    }

    /** Cancelled and past its paid-through date — inactive. */
    data object Cancelled : SubscriptionState {
        override val isActive = false
        override val billingIssue = false
    }

    /** Refunded / charged-back — inactive. */
    data object Refunded : SubscriptionState {
        override val isActive = false
        override val billingIssue = false
    }

    /** Purchase acknowledged but not yet confirmed by the provider — inactive until it resolves. */
    data object Pending : SubscriptionState {
        override val isActive = false
        override val billingIssue = false
    }
}
