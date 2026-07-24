package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.billing.NativeBillingClient
import com.mobilebytelabs.paycraft.model.Entitlement
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.persistence.EntitlementCache
import com.mobilebytelabs.paycraft.persistence.EntitlementKey
import kotlinx.coroutines.flow.Flow
import org.mobilenativefoundation.store.store5.StoreReadRequest
import org.mobilenativefoundation.store.store5.StoreReadResponse
import org.mobilenativefoundation.store.store5.impl.extensions.fresh

/** Native providers cancel via a store deep-link; every other provider is a PSP API cancel (D7). */
private val NATIVE_STORE_PROVIDERS = setOf("app_store", "apple", "play", "google")

/**
 * Orchestrates entitlement reads + restore/cancel over the Store5 [EntitlementCache], the native
 * store client, and the PSP-API cancel path (D7/D8, AC5/AC6/AC9).
 *
 * Reads (S5-DUAL — RULE-IMPLEMENT-STORE5-001): [stream] is the offline-tolerant cached read that
 * gating binds to; [streamFresh] is the forced-revalidate sibling used on foreground/purchase so
 * cold-start gating can never wedge on permanently-stale cache (S5-5).
 */
class EntitlementRepository(
    private val cache: EntitlementCache,
    private val native: NativeBillingClient,
    private val service: PayCraftService,
) {
    /** Cached read — serves the offline last-known-good from the SoT (refresh = false). */
    fun stream(appUserId: String): Flow<StoreReadResponse<Entitlement>> =
        cache.store.stream(StoreReadRequest.cached(EntitlementKey(appUserId), refresh = false))

    /** Forced-revalidate sibling — emits cache then reconciles from the server (refresh = true). */
    fun streamFresh(appUserId: String): Flow<StoreReadResponse<Entitlement>> =
        cache.store.stream(StoreReadRequest.cached(EntitlementKey(appUserId), refresh = true))

    /**
     * Cross-platform restore keyed by the STABLE app-user-id, NOT the store account (AC5).
     *
     * 1. [NativeBillingClient.sync] re-links store receipts to the signed-in store account
     *    (StoreKit `AppStore.sync()` / Play `queryPurchasesAsync()`).
     * 2. [NativeBillingClient.restore] surfaces the recovered native purchases so the engine can
     *    reconcile them.
     * 3. `store.fresh(appUserId)` forces one server reconcile → the ONE canonical record, so a
     *    subscription bought on platform A becomes active on platform B (different store account,
     *    same app-user-id).
     */
    suspend fun restore(appUserId: String): Entitlement {
        native.sync()
        native.restore()
        return cache.store.fresh(EntitlementKey(appUserId))
    }

    /**
     * Per-provider cancel/manage dispatch (AC6):
     *  - native store (`app_store`/`play`) → deep-link the store subscription centre via
     *    [NativeBillingClient.manageSubscription] (programmatic cancel is forbidden by the stores);
     *  - PSP (`stripe`/`razorpay`/…) → [PayCraftService.cancelSubscription] API cancel.
     *
     * @return true when the cancel/manage action was dispatched successfully.
     */
    suspend fun manageSubscription(entitlement: Entitlement): Boolean =
        if (entitlement.provider.lowercase() in NATIVE_STORE_PROVIDERS) {
            native.manageSubscription(entitlement.product)
            true
        } else {
            val subscriptionId = requireNotNull(entitlement.subscriptionId) {
                "PSP cancel for provider=${entitlement.provider} requires a subscriptionId"
            }
            service.cancelSubscription(entitlement.provider, subscriptionId)
        }

    /** Alias for [manageSubscription] — the D7 "cancel" verb dispatches identically. */
    suspend fun cancel(entitlement: Entitlement): Boolean = manageSubscription(entitlement)

    /** Offline gating decision for [entitlement] at [now] — delegates to the Store5 cache (AC9). */
    fun isServableOffline(entitlement: Entitlement, now: Long): Boolean = cache.isServableOffline(entitlement, now)
}
