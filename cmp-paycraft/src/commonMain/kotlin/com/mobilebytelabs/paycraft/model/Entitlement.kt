package com.mobilebytelabs.paycraft.model

/**
 * Normalized entitlement record — one idempotent row the reconciliation engine (Phase 2)
 * UPSERTs, keyed by [userId] (the app-user-id).
 *
 * Timestamps are carried as portable primitives so this record stays dependency-free in
 * `commonMain`: [expiresAt] / [inGraceUntil] are ISO-8601 strings (as returned by the
 * provider webhooks / Supabase), and [latestEventTs] is an epoch-millis watermark used to
 * discard out-of-order provider events during reconciliation. Gating truth is NOT stored
 * on the row — it is derived from [canonicalState] so there is exactly one source of the
 * grace = active / retry = inactive rule (D6).
 */
data class Entitlement(
    /** App-user-id — the reconciliation key (one row per user, UPSERTed). */
    val userId: String,
    /** Stable provider id, e.g. "apple", "google", "stripe", "razorpay". */
    val provider: String,
    /** Provider product / plan identifier. */
    val product: String,
    /** Canonical state — the single source of gating truth. */
    val canonicalState: SubscriptionState,
    /** ISO-8601 paid-through / expiry instant, or null when open-ended / unknown. */
    val expiresAt: String?,
    /** Whether the subscription is set to auto-renew at [expiresAt]. */
    val willRenew: Boolean,
    /** ISO-8601 instant the grace window closes, when [canonicalState] is [SubscriptionState.InGracePeriod]. */
    val inGraceUntil: String? = null,
    /** True for sandbox / test purchases — kept out of production gating analytics. */
    val isSandbox: Boolean = false,
    /**
     * Provider-side subscription identifier used by the per-provider cancel dispatch (D7).
     *
     * For PSP providers (Stripe `sub_…`, Razorpay `sub_…`) this is the id passed to
     * [com.mobilebytelabs.paycraft.core.EntitlementRepository.cancel]'s API-cancel path.
     * Native-store subscriptions cancel via a deep-link (Play sub-center / StoreKit
     * `showManageSubscriptions`) and do NOT require this id, so it is nullable.
     */
    val subscriptionId: String? = null,
    /** Epoch-millis of the latest provider event folded into this row (out-of-order guard). */
    val latestEventTs: Long,
) {
    /** Gating truth — delegates to the canonical machine (grace counts as active). */
    val isActive: Boolean get() = canonicalState.isActive

    /** True when the provider is signalling a payment problem (grace or billing-retry). */
    val hasBillingIssue: Boolean get() = canonicalState.billingIssue
}
