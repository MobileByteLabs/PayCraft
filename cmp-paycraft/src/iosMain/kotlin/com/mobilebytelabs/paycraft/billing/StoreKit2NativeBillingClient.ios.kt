package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.storekit.PCOutcomeKindCancelled
import com.mobilebytelabs.paycraft.storekit.PCOutcomeKindPending
import com.mobilebytelabs.paycraft.storekit.PCOutcomeKindSuccess
import com.mobilebytelabs.paycraft.storekit.PCPrice
import com.mobilebytelabs.paycraft.storekit.PCTransaction
import com.mobilebytelabs.paycraft.storekit.PayCraftStoreKitShim
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/**
 * iOS [NativeBillingClient] over **StoreKit 2**.
 *
 * The StoreKit calls live in [PayCraftStoreKitShim] — an SDK-INTERNAL Swift file compiled into a
 * static archive and reached through cinterop (`src/nativeInterop/swift/PayCraftStoreKitShim.swift`).
 * This class is the device-free Kotlin adapter that maps its results onto the store-agnostic
 * [NativeBillingClient] contract.
 *
 * It used to take the bridge as a constructor parameter, injected by the CONSUMING APP from a Swift
 * file each app kept its own copy of. That is gone: the shim is constructed here, the consumer's
 * integration is `PayCraft.initialize(apiKey)` in commonMain and nothing else, and there is no
 * per-app Swift to drift (cappy's copy had already diverged 91 lines from canonical).
 *
 * Like the Android client it is a *pure store adapter* (D5): it surfaces the signed JWS as
 * [NativePurchase.purchaseToken] for the server to re-verify against Apple, and never decides
 * entitlement truth itself.
 */
@OptIn(ExperimentalForeignApi::class)
internal class StoreKit2NativeBillingClient(private val shim: PayCraftStoreKitShim = PayCraftStoreKitShim()) :
    NativeBillingClient {

    private val outboundUpdates = MutableSharedFlow<NativePurchase>(
        replay = 0,
        extraBufferCapacity = 16,
    )

    override val purchaseUpdates: Flow<NativePurchase> = outboundUpdates.asSharedFlow()

    init {
        // Apple requires this listener to run for the process lifetime. It is the ONLY delivery path
        // for renewals, Ask-to-Buy approvals, family-sharing grants, refunds, revocations, and
        // transactions interrupted mid-purchase.
        shim.startTransactionUpdates { transaction ->
            transaction?.let { outboundUpdates.tryEmit(it.toNativePurchase()) }
        }
    }

    override suspend fun purchase(
        productId: String,
        appUserId: String?,
        productType: NativeProductType,
    ): NativePurchaseResult = // StoreKit resolves the product type from the product itself, so no branch is needed here
        // the way Play needs SUBS vs INAPP up front.
        suspendCancellableCoroutine { cont ->
            shim.purchase(productId, appUserId?.let(::appAccountToken)) { outcome ->
                val result = when (outcome?.kind) {
                    PCOutcomeKindSuccess ->
                        outcome.transaction
                            ?.let { NativePurchaseResult.Success(it.toNativePurchase()) }
                            ?: NativePurchaseResult.Failed("StoreKit reported success with no transaction")

                    PCOutcomeKindCancelled -> NativePurchaseResult.Cancelled

                    PCOutcomeKindPending -> NativePurchaseResult.Pending(
                        // Ask to Buy / SCA: no verified transaction exists yet, so this placeholder
                        // carries only what we know. The real one arrives on [purchaseUpdates] when
                        // the approval lands.
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

                    else -> NativePurchaseResult.Failed(outcome?.message ?: "StoreKit purchase failed")
                }
                cont.resume(result)
            }
        }

    /**
     * Finish the transaction with StoreKit — only ever after the server has recorded the
     * entitlement. Anything still unfinished is re-delivered on the next launch by
     * `Transaction.updates`, which is exactly the retry we want.
     */
    override suspend fun finishPurchase(purchase: NativePurchase) {
        val transactionId = purchase.storeKitTransactionId ?: return
        suspendCancellableCoroutine { cont ->
            shim.finish(transactionId) { cont.resume(Unit) }
        }
    }

    override suspend fun queryPurchases(): List<NativePurchase> = suspendCancellableCoroutine { cont ->
        shim.currentEntitlementsWithCompletion { list ->
            cont.resume(list.orEmpty().filterIsInstance<PCTransaction>().map { it.toNativePurchase() })
        }
    }

    override suspend fun sync() {
        suspendCancellableCoroutine { cont ->
            // A sync failure is non-fatal for restore — currentEntitlements still reads the local
            // receipt — so the message is swallowed here rather than thrown.
            shim.syncWithCompletion { cont.resume(Unit) }
        }
    }

    override suspend fun restore(): List<NativePurchase> {
        sync()
        return queryPurchases()
    }

    override suspend fun manageSubscription(productId: String?) {
        // Product-specific management is not addressable; StoreKit's own sheet needs a
        // UIWindowScene, and the shim falls back to the account-level deep-link when there is none.
        // productId is accepted for contract parity (D7).
        suspendCancellableCoroutine { cont ->
            shim.showManageSubscriptionsWithCompletion { cont.resume(Unit) }
        }
    }

    override suspend fun storefrontCountry(): String? = suspendCancellableCoroutine { cont ->
        shim.storefrontCountryWithCompletion { country -> cont.resume(country) }
    }

    override suspend fun nativeDisplayPrice(productId: String, productType: NativeProductType): NativeDisplayPrice? =
        suspendCancellableCoroutine { cont ->
            shim.displayPrice(productId) { price: PCPrice? ->
                cont.resume(
                    price?.let {
                        NativeDisplayPrice(
                            formatted = it.formatted,
                            currencyCode = it.currencyCode,
                            amountMicros = it.amountMicros,
                        )
                    },
                )
            }
        }

    private fun PCTransaction.toNativePurchase(): NativePurchase = NativePurchase(
        productId = productId,
        purchaseToken = jws,
        originalTransactionId = originalTransactionId,
        purchaseTimeMillis = purchaseTimeMillis,
        // The REAL renewal switch (RenewalInfo.willAutoRenew), resolved in the shim — not "is this
        // an auto-renewable product", which stayed true for cancelled subscriptions and made the
        // paywall promise a charge that was never coming.
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
