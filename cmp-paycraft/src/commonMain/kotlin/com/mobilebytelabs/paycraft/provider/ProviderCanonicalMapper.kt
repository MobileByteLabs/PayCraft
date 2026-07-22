package com.mobilebytelabs.paycraft.provider

import com.mobilebytelabs.paycraft.model.SubscriptionState

/**
 * Seam: a provider's raw store/PSP status → canonical [SubscriptionState].
 *
 * This is the state-normalization interface, DISTINCT from the checkout-facing
 * [PaymentProvider] interface the 11 provider classes already implement. Per-provider
 * implementations (Apple StoreKit2, Google Play, Stripe, Razorpay, and the +7 web PSPs)
 * land in Phase 2/3 and register into Koin DI there; this phase only pins the seam so no
 * adapter re-derives the D6 grace = active / retry = inactive machine.
 */
interface ProviderCanonicalMapper {
    /** Stable provider id, e.g. "apple", "google", "stripe", "razorpay". */
    val providerId: String

    /**
     * Map a provider-native status token to the canonical machine.
     *
     * @param rawStatus the provider's own status string (e.g. Stripe `past_due`, Play `on_hold`).
     * @param inGracePeriod true when the provider reports the subscription is in its billing grace window.
     * @param onBillingRetry true when the provider is actively retrying a failed charge (access suspended).
     * @param willRenew whether the subscription is set to auto-renew (distinguishes Active vs ActiveNonRenewing).
     * @return the canonical [SubscriptionState] the reconciliation engine folds into the [com.mobilebytelabs.paycraft.model.Entitlement] row.
     */
    fun toCanonical(
        rawStatus: String,
        inGracePeriod: Boolean,
        onBillingRetry: Boolean,
        willRenew: Boolean,
    ): SubscriptionState
}
