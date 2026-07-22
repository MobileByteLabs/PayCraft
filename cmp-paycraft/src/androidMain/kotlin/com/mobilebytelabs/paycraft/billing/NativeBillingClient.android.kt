package com.mobilebytelabs.paycraft.billing

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import co.touchlab.kermit.Logger
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.acknowledgePurchase
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlin.coroutines.resume

/**
 * Android [NativeBillingClient] over **Google Play Billing Library v8**
 * (`com.android.billingclient:billing-ktx:8.0.0`) — the Phase-3 native IAP client (D8/D13).
 *
 * v8 is required for all new apps by 2026-08-31 (GOAL Risks). This client is a *pure store
 * adapter* (D5): it drives the Play purchase / query / manage flows and emits [NativePurchase]
 * records (product id + `purchaseToken` + order id) for the Phase-2 reconciliation engine to
 * validate server-side (`subscriptionsv2.get`). It NEVER decides entitlement truth.
 *
 * Flow:
 *  - [purchase] — lazily connects, `queryProductDetails` for the SUBS product, resolves the base
 *    offer token, `launchBillingFlow`, awaits the [PurchasesUpdatedListener] callback, then
 *    acknowledges the purchase (a subscription left un-acknowledged for 3 days is auto-refunded).
 *  - [queryPurchases] / [restore] — `queryPurchasesAsync(SUBS)` for the signed-in Play account.
 *  - [sync] — Play's re-link IS `queryPurchasesAsync` (there is no separate StoreKit-style sync).
 *  - [manageSubscription] — deep-links the Play subscription centre (stores forbid programmatic
 *    cancel — D7); a non-null product id targets the specific plan.
 *
 * DI: bind on Android via [com.mobilebytelabs.paycraft.di.paycraftPlayBillingModule], which
 * overrides the default `WebCheckoutNativeBillingClient` binding from `PayCraftModule`.
 *
 * @param context application context — used to construct the [BillingClient] and to launch the
 *   Play subscription-centre intent for [manageSubscription].
 * @param activityProvider supplies the current foreground [Activity] required by
 *   `launchBillingFlow`; returns null when no Activity is resumed (purchase then fails cleanly).
 */
class PlayBillingNativeClient(
    context: Context,
    private val activityProvider: () -> Activity?,
) : NativeBillingClient {

    private val appContext: Context = context.applicationContext

    /** Buffered so a purchase callback that arrives before [purchase] suspends is not dropped. */
    private val purchaseUpdates = MutableSharedFlow<PurchasesUpdate>(extraBufferCapacity = 1)

    private val connectMutex = Mutex()

    private val purchasesListener = PurchasesUpdatedListener { billingResult, purchases ->
        purchaseUpdates.tryEmit(PurchasesUpdate(billingResult, purchases.orEmpty()))
    }

    private val billingClient: BillingClient = BillingClient.newBuilder(appContext)
        .enablePendingPurchases(
            PendingPurchasesParams.newBuilder()
                .enableOneTimeProducts()
                .enablePrepaidPlans()
                .build(),
        )
        .setListener(purchasesListener)
        .build()

    override suspend fun purchase(productId: String): NativePurchaseResult {
        val connect = ensureConnected()
        if (connect.responseCode != BillingResponseCode.OK) {
            return NativePurchaseResult.Failed("Play billing connect failed: ${connect.debugMessage}")
        }
        val productDetails = queryProductDetails(productId)
            ?: return NativePurchaseResult.Failed("Product not found on Play: $productId")
        val offerToken = productDetails.subscriptionOfferDetails?.firstOrNull()?.offerToken
            ?: return NativePurchaseResult.Failed("No subscription offer for $productId")
        val activity = activityProvider()
            ?: return NativePurchaseResult.Failed("No foreground Activity to launch the billing flow")

        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(
                listOf(
                    BillingFlowParams.ProductDetailsParams.newBuilder()
                        .setProductDetails(productDetails)
                        .setOfferToken(offerToken)
                        .build(),
                ),
            )
            .build()

        val launch = billingClient.launchBillingFlow(activity, flowParams)
        if (launch.responseCode != BillingResponseCode.OK) {
            return NativePurchaseResult.Failed("launchBillingFlow failed: ${launch.debugMessage}")
        }

        val update = purchaseUpdates.first()
        return when (update.billingResult.responseCode) {
            BillingResponseCode.OK -> {
                val purchase = update.purchases.firstOrNull { productId in it.products }
                    ?: update.purchases.firstOrNull()
                    ?: return NativePurchaseResult.Failed("Play reported OK with no Purchase")
                acknowledgeIfNeeded(purchase)
                NativePurchaseResult.Success(purchase.toNativePurchase())
            }
            BillingResponseCode.USER_CANCELED -> NativePurchaseResult.Cancelled
            else -> NativePurchaseResult.Failed("Purchase failed: ${update.billingResult.debugMessage}")
        }
    }

    override suspend fun queryPurchases(): List<NativePurchase> {
        ensureConnected()
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(BillingClient.ProductType.SUBS)
            .build()
        val result = billingClient.queryPurchasesAsync(params)
        return result.purchasesList
            .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED }
            .map { it.toNativePurchase() }
    }

    /** Play's receipt re-link IS `queryPurchasesAsync` — there is no separate sync endpoint (D7). */
    override suspend fun sync() {
        queryPurchases()
    }

    override suspend fun restore(): List<NativePurchase> = queryPurchases()

    override suspend fun manageSubscription(productId: String?) {
        val url = if (productId != null) {
            "https://play.google.com/store/account/subscriptions" +
                "?sku=$productId&package=${appContext.packageName}"
        } else {
            "https://play.google.com/store/account/subscriptions"
        }
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        appContext.startActivity(intent)
    }

    private suspend fun queryProductDetails(productId: String): ProductDetails? {
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(BillingClient.ProductType.SUBS)
                        .build(),
                ),
            )
            .build()
        val result = billingClient.queryProductDetails(params)
        return result.productDetailsList?.firstOrNull()
    }

    private suspend fun acknowledgeIfNeeded(purchase: Purchase) {
        if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED || purchase.isAcknowledged) return
        val ack = billingClient.acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.purchaseToken)
                .build(),
        )
        if (ack.responseCode != BillingResponseCode.OK) {
            Logger.w("PlayBillingNativeClient") {
                "acknowledgePurchase failed (${ack.responseCode}): ${ack.debugMessage}"
            }
        }
    }

    /** Idempotent, serialized connect — no-op when the client is already ready. */
    private suspend fun ensureConnected(): BillingResult = connectMutex.withLock {
        if (billingClient.isReady) return@withLock okResult()
        suspendCancellableCoroutine { cont ->
            billingClient.startConnection(
                object : BillingClientStateListener {
                    override fun onBillingSetupFinished(billingResult: BillingResult) {
                        if (cont.isActive) cont.resume(billingResult)
                    }

                    // Next ensureConnected() reconnects lazily via the isReady guard above.
                    override fun onBillingServiceDisconnected() = Unit
                },
            )
        }
    }

    private fun okResult(): BillingResult =
        BillingResult.newBuilder().setResponseCode(BillingResponseCode.OK).build()

    private fun Purchase.toNativePurchase(): NativePurchase = NativePurchase(
        productId = products.firstOrNull().orEmpty(),
        purchaseToken = purchaseToken,
        originalTransactionId = orderId,
        purchaseTimeMillis = purchaseTime,
        isAutoRenewing = isAutoRenewing,
    )

    private data class PurchasesUpdate(
        val billingResult: BillingResult,
        val purchases: List<Purchase>,
    )
}
