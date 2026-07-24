package com.mobilebytelabs.paycraft.model

/**
 * Additive bridge between the canonical [SubscriptionState] machine (this phase) and the
 * legacy [SubscriptionStatus] premium snapshot. This does NOT rewire the existing surfaces
 * ([SubscriptionStatus] / [BillingState] / PayCraftBillingManager stay authoritative for the
 * consumer UI until Phase 4) — it only lets the new canonical layer round-trip through the
 * old one so neither is orphaned and no gating logic is duplicated.
 */

/**
 * Derive a canonical [SubscriptionState] from a legacy [SubscriptionStatus].
 *
 * The legacy snapshot only distinguishes premium-or-not (+ renew intent), so it maps onto the
 * always-active canonical states: [SubscriptionState.Active] when it will renew,
 * [SubscriptionState.ActiveNonRenewing] when it won't, and [SubscriptionState.Expired] when not
 * premium. Richer states (grace / retry / trial / paused) require a [ProviderCanonicalMapper]
 * with real provider signals and are produced by the reconciliation engine in Phase 2/3.
 */
fun SubscriptionStatus.toCanonicalState(): SubscriptionState = when {
    !isPremium -> SubscriptionState.Expired
    willRenew -> SubscriptionState.Active
    else -> SubscriptionState.ActiveNonRenewing
}

/**
 * Project a canonical [SubscriptionState] back onto the legacy [SubscriptionStatus] snapshot the
 * consumer UI reads. [isPremium] follows canonical [SubscriptionState.isActive] (so grace stays
 * premium, D6), and [SubscriptionStatus.willRenew] is preserved from [willRenew].
 */
fun SubscriptionState.toSubscriptionStatus(
    plan: String? = null,
    email: String? = null,
    provider: String? = null,
    expiresAt: String? = null,
    willRenew: Boolean = this !is SubscriptionState.ActiveNonRenewing,
): SubscriptionStatus = SubscriptionStatus(
    isPremium = isActive,
    plan = plan,
    email = email,
    provider = provider,
    expiresAt = expiresAt,
    willRenew = willRenew,
)

/** Project an [Entitlement] onto the legacy [SubscriptionStatus] the consumer UI reads. */
fun Entitlement.toSubscriptionStatus(email: String? = null): SubscriptionStatus = canonicalState.toSubscriptionStatus(
    plan = product,
    email = email,
    provider = provider,
    expiresAt = expiresAt,
    willRenew = willRenew,
)
