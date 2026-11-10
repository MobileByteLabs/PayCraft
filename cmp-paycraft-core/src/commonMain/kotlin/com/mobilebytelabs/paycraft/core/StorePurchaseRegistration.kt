package com.mobilebytelabs.paycraft.core

import com.mobilebytelabs.paycraft.PayCraft
import com.mobilebytelabs.paycraft.billing.NativePurchase
import com.mobilebytelabs.paycraft.debug.PayCraftLogger
import com.mobilebytelabs.paycraft.network.EntitlementDto
import com.mobilebytelabs.paycraft.network.PayCraftService
import com.mobilebytelabs.paycraft.platform.PlatformInfo

/** The running platform, lower-cased; empty when it cannot be resolved (tests, early init). */
internal fun currentPlatform(): String = runCatching { PlatformInfo.platform.lowercase() }.getOrDefault("")

/**
 * Bind one store purchase to [appUserId] server-side — the store's grant endpoint for [platform].
 *
 * The server re-fetches truth from the store, then decides ownership (`claimStoreTransaction`): a
 * purchase held by an anonymous device id moves to [appUserId]; one held by a signed-in identity is
 * refused (`sign_in_required`), which surfaces here as null like any other non-grant.
 *
 * @return the reconciled entitlement, or null when the server did not record it.
 */
internal suspend fun PayCraftService.registerStorePurchase(
    purchase: NativePurchase,
    appUserId: String,
    platform: String,
): EntitlementDto? = when (platform) {
    "android" -> registerPlayPurchase(
        purchaseToken = purchase.purchaseToken,
        productId = purchase.productId,
        appUserId = appUserId,
        packageName = purchase.packageName.orEmpty(),
    )
    "ios", "macos" -> registerAppStorePurchase(
        signedTransaction = purchase.purchaseToken,
        appUserId = appUserId,
        productId = purchase.productId,
    )
    else -> null
}

private const val TAG_RELINK = "relinkStorePurchases"

/**
 * Re-bind every purchase the store holds for this device's store account to [appUserId].
 *
 * Runs on restore and on sign-in. The anonymous app-user-id is a device id, which changes on
 * reinstall and on a new phone while the store account does not — so without this a store-only
 * buyer reads Free after a reinstall, and a purchase made before sign-in never reaches the signed-in
 * identity the other platform reads.
 *
 * Skips what is not an entitlement: a pending payment (not cleared) and a consumable (granted once,
 * then consumed — re-sending it would ask for a second grant).
 *
 * @return how many purchases the server bound.
 */
internal suspend fun PayCraftService.relinkStorePurchases(
    purchases: List<NativePurchase>,
    appUserId: String,
    platform: String,
): Int = purchases
    .filter { !it.isPending && !isConsumableStoreProduct(it.productId) }
    .count { purchase ->
        val bound = runCatching { registerStorePurchase(purchase, appUserId, platform) }
            .onFailure { PayCraftLogger.onError(TAG_RELINK, "${purchase.productId}: ${it.message}") }
            .getOrNull()
        if (bound == null) PayCraftLogger.onFlow(TAG_RELINK, "${purchase.productId} not bound")
        bound != null
    }

/**
 * Is this STORE product id a consumable?
 *
 * A [NativePurchase] carries the store's product id — NOT the PayCraft sku. Those differ
 * (`cappy_plus_annual` vs `com.example.app.sub.year`), so the lookup must go through
 * [com.mobilebytelabs.paycraft.model.BillingPlan.storeBinding], never `sku`.
 *
 * Defaults to FALSE when the catalogue has not loaded or the product is unknown. That is the
 * safe direction: acknowledging a consumable leaves it unrepurchasable until the next reconcile,
 * whereas consuming a non-consumable would discard a permanent entitlement.
 */
internal fun isConsumableStoreProduct(storeProductId: String): Boolean =
    PayCraft.plans.firstOrNull { it.storeBinding?.productId == storeProductId }?.isConsumable == true
