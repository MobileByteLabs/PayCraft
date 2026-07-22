package com.mobilebytelabs.paycraft.billing

import platform.Foundation.NSURL
import platform.UIKit.UIApplication

/**
 * iOS [NativeBillingClient] over **StoreKit2** — the Phase-3 native IAP client (D8/D13).
 *
 * StoreKit2 is Swift-only, so the store calls (`Product.purchase()`,
 * `Transaction.currentEntitlements`, `AppStore.sync()`) run in the injected [StoreKit2Bridge]
 * Swift shim (`iosMain/swift/PayCraftStoreKit2.swift`); this class is the device-free Kotlin
 * adapter that maps the bridge results onto the store-agnostic [NativeBillingClient] contract.
 *
 * Like the Android client it is a *pure store adapter* (D5): it surfaces the signed JWS as
 * [NativePurchase.purchaseToken] for the Phase-2 engine to re-verify against Apple, and never
 * decides entitlement truth itself.
 *
 *  - [purchase] — bridge `Product.purchase()`; maps `.userCancelled`/`.pending`/errors.
 *  - [queryPurchases] — bridge `Transaction.currentEntitlements` (no network re-link).
 *  - [sync] / [restore] — bridge `AppStore.sync()` to re-link receipts, then re-read entitlements.
 *  - [manageSubscription] — deep-links the App Store account subscriptions surface; StoreKit's own
 *    `showManageSubscriptions(in:)` is offered by the shim when a `UIWindowScene` is available, but
 *    the account deep-link works app-wide and needs no scene (stores forbid programmatic cancel, D7).
 *
 * DI: bind on iOS via [com.mobilebytelabs.paycraft.di.paycraftStoreKit2BillingModule], which
 * overrides the default `WebCheckoutNativeBillingClient` binding from `PayCraftModule`.
 */
class StoreKit2NativeBillingClient(
    private val bridge: StoreKit2Bridge,
) : NativeBillingClient {

    override suspend fun purchase(productId: String): NativePurchaseResult =
        when (val outcome = bridge.purchase(productId)) {
            is StoreKit2Outcome.Success -> NativePurchaseResult.Success(outcome.transaction.toNativePurchase())
            StoreKit2Outcome.Cancelled -> NativePurchaseResult.Cancelled
            is StoreKit2Outcome.Failed -> NativePurchaseResult.Failed(outcome.message)
        }

    override suspend fun queryPurchases(): List<NativePurchase> =
        bridge.currentEntitlements().map { it.toNativePurchase() }

    override suspend fun sync() {
        bridge.sync()
    }

    override suspend fun restore(): List<NativePurchase> {
        bridge.sync()
        return bridge.currentEntitlements().map { it.toNativePurchase() }
    }

    override suspend fun manageSubscription(productId: String?) {
        // Product-specific management is not addressable via URL; StoreKit2's
        // showManageSubscriptions(in:) needs a UIWindowScene, so the account-level deep-link is the
        // scene-free path that always works. productId is accepted for contract parity (D7).
        val url = NSURL.URLWithString(MANAGE_SUBSCRIPTIONS_URL) ?: return
        UIApplication.sharedApplication.openURL(url)
    }

    private fun StoreKit2Transaction.toNativePurchase(): NativePurchase = NativePurchase(
        productId = productId,
        purchaseToken = jwsRepresentation,
        originalTransactionId = originalId,
        purchaseTimeMillis = purchaseDateMillis,
        isAutoRenewing = isAutoRenewing,
    )

    private companion object {
        const val MANAGE_SUBSCRIPTIONS_URL = "itms-apps://apps.apple.com/account/subscriptions"
    }
}
