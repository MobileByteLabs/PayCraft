package com.mobilebytelabs.paycraft.billing

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
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
class StoreKit2NativeBillingClient(private val bridge: StoreKit2Bridge) : NativeBillingClient {

    private val outboundUpdates = MutableSharedFlow<NativePurchase>(extraBufferCapacity = 16)

    override val purchaseUpdates: Flow<NativePurchase> = outboundUpdates.asSharedFlow()

    init {
        // Apple requires Transaction.updates to be attached at launch and kept for the process
        // lifetime. It is the ONLY delivery path for renewals, Ask-to-Buy approvals, family-sharing
        // grants, refunds, revocations, and purchases interrupted mid-flight.
        bridge.startTransactionUpdates { transaction ->
            outboundUpdates.tryEmit(transaction.toNativePurchase())
        }
    }

    override suspend fun purchase(
        productId: String,
        appUserId: String?,
        productType: NativeProductType,
    ): NativePurchaseResult = // StoreKit resolves the product type from the product itself, so no branch is needed here
        // the way Play needs SUBS vs INAPP up front.
        when (val outcome = bridge.purchase(productId, appUserId?.let(::appAccountToken))) {
            is StoreKit2Outcome.Success -> NativePurchaseResult.Success(outcome.transaction.toNativePurchase())
            StoreKit2Outcome.Cancelled -> NativePurchaseResult.Cancelled
            StoreKit2Outcome.Pending -> NativePurchaseResult.Pending(
                // Ask to Buy / SCA: no verified transaction exists yet, so this placeholder carries
                // only what we know. The real transaction arrives on [purchaseUpdates] when the
                // approval lands.
                NativePurchase(
                    productId = productId,
                    purchaseToken = "",
                    originalTransactionId = null,
                    purchaseTimeMillis = 0L,
                    isAutoRenewing = false,
                    isPending = true,
                    isAcknowledged = false,
                ),
            )
            is StoreKit2Outcome.Failed -> NativePurchaseResult.Failed(outcome.message)
        }

    /**
     * Finish the transaction with StoreKit — only ever after the server has recorded the
     * entitlement. Anything still unfinished is re-delivered on the next launch by
     * `Transaction.updates`, which is exactly the retry we want.
     */
    override suspend fun finishPurchase(purchase: NativePurchase) {
        val transactionId = purchase.storeKitTransactionId ?: return
        bridge.finish(transactionId)
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

    override suspend fun storefrontCountry(): String? = bridge.storefrontCountry()

    override suspend fun nativeDisplayPrice(productId: String, productType: NativeProductType): NativeDisplayPrice? =
        bridge.displayPrice(productId)?.let {
            NativeDisplayPrice(formatted = it.formatted, currencyCode = it.currencyCode, amountMicros = it.amountMicros)
        }

    private fun StoreKit2Transaction.toNativePurchase(): NativePurchase = NativePurchase(
        productId = productId,
        purchaseToken = jwsRepresentation,
        originalTransactionId = originalId,
        purchaseTimeMillis = purchaseDateMillis,
        // Now the REAL renewal switch (Product.SubscriptionInfo.RenewalInfo.willAutoRenew), not
        // "is this an auto-renewable product" — which reported true for cancelled subscriptions
        // and made the paywall promise a charge that was never coming.
        isAutoRenewing = isAutoRenewing,
        // StoreKit's per-transaction id rides in packageName, the one free-form slot on the
        // store-agnostic value object (Play uses it for the app package, which StoreKit has no
        // equivalent of). [storeKitTransactionId] reads it back.
        packageName = transactionId.takeIf { it.isNotBlank() },
        isPending = false,
        isAcknowledged = !isUnfinished,
    )

    /** The StoreKit transaction id carried through [NativePurchase.packageName]. */
    private val NativePurchase.storeKitTransactionId: String?
        get() = packageName?.takeIf { it.isNotBlank() }

    private companion object {
        const val MANAGE_SUBSCRIPTIONS_URL = "itms-apps://apps.apple.com/account/subscriptions"
    }
}

/**
 * StoreKit requires `appAccountToken` to be a UUID, but the SDK's app-user id is an email or a
 * device id. Derive a stable UUID-shaped token from it so the same buyer always produces the same
 * token and the server-side notification can attribute the transaction.
 */
private fun appAccountToken(appUserId: String): String {
    var h1 = -0x340d631b00000000L
    var h2 = 0x2545f4914f6cdd1dL
    for (c in appUserId) {
        h1 = (h1 xor c.code.toLong()) * 0x100000001b3L
        h2 = (h2 + c.code.toLong()) * 0x27220a95L
    }
    val a = h1.toULong().toString(16).padStart(16, '0')
    val b = h2.toULong().toString(16).padStart(16, '0')
    return "${a.substring(0, 8)}-${a.substring(8, 12)}-${a.substring(12, 16)}-" +
        "${b.substring(0, 4)}-${b.substring(4, 16)}"
}
