package com.mobilebytelabs.paycraft.canary.restore.red

/**
 * RED canary fixture (AC5): the DELIBERATELY BUGGY restore keying — restore keyed by the STORE
 * ACCOUNT instead of the stable app-user-id. The second platform signs in with a DIFFERENT store
 * account, so it reconciles against a key the server never saw and its entitlement is lost.
 *
 * The GREEN test ([RestoreCrossPlatformCanaryTest]) asserts that restoring by a store-account key
 * fails to surface the entitlement, and that keying by the stable app-user-id makes it active on
 * the second platform. Never promoted to production.
 *
 * intentional-noop: this is a red-canary fixture, not production code — keying by store account is
 * the bug being demonstrated.
 */
object RestoreCrossPlatformRedFixture {
    /** WRONG: uses the per-platform store account as the reconcile key. */
    fun keyForRestore(storeAccountId: String): String = storeAccountId
}
