package com.mobilebytelabs.paycraft.billing

import com.mobilebytelabs.paycraft.debug.PayCraftLogLevel
import com.mobilebytelabs.paycraft.debug.platformLog
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingConfig
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.GetBillingConfigParams
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.android.billingclient.api.acknowledgePurchase
import com.android.billingclient.api.queryProductDetails
import com.android.billingclient.api.queryPurchasesAsync
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Android [NativeBillingClient] over **Google Play Billing Library v9**
 * (`com.android.billingclient:billing-ktx`, version pinned in `libs.versions.toml`) — the Phase-3
 * native IAP client (D8/D13).
 *
 * v8+ is required for all new apps by 2026-08-31 (GOAL Risks); this client tracks the v9 line.
 * It uses only the modern `ProductDetails` surface, never the SKU-era APIs (`SkuDetails`,
 * `QueryPurchaseHistoryParams`, `BillingClient.SkuType`) that v9 REMOVED outright — which is why
 * the 8.x→9.x move needed no code change here. This client is a *pure store adapter* (D5): it drives the Play purchase / query / manage flows and emits [NativePurchase]
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
class PlayBillingNativeClient(context: Context, private val activityProvider: () -> Activity?) : NativeBillingClient {

    private val appContext: Context = context.applicationContext

    /**
     * Raw Play callbacks. Buffered so a callback that arrives before [purchase] suspends is not
     * dropped, and replayed to no-one — [purchaseUpdates] is the public projection.
     */
    private val rawUpdates = MutableSharedFlow<PurchasesUpdate>(extraBufferCapacity = 8)

    /**
     * ALWAYS-ON out-of-band purchase stream.
     *
     * Play's [PurchasesUpdatedListener] fires for purchases nobody is awaiting — a promo code
     * redeemed in the Play app, a deferred payment clearing, a purchase completing after the app
     * was backgrounded. Previously the only consumer was `purchase()`'s `first()`, so every such
     * callback was silently discarded and the buyer stayed un-upgraded.
     */
    private val outboundUpdates = MutableSharedFlow<NativePurchase>(extraBufferCapacity = 16)

    override val purchaseUpdates: Flow<NativePurchase> = outboundUpdates.asSharedFlow()

    private val connectMutex = Mutex()

    private val purchasesListener = PurchasesUpdatedListener { billingResult, purchases ->
        val update = PurchasesUpdate(billingResult, purchases.orEmpty())
        rawUpdates.tryEmit(update)
        // Fan every OK purchase out to the always-on stream too, regardless of whether a
        // purchase() call is currently awaiting one.
        if (billingResult.responseCode == BillingResponseCode.OK) {
            update.purchases.forEach { outboundUpdates.tryEmit(it.toNativePurchase()) }
        }
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

    override suspend fun purchase(
        productId: String,
        appUserId: String?,
        productType: NativeProductType,
    ): NativePurchaseResult {
        val connect = ensureConnected()
        if (connect.responseCode != BillingResponseCode.OK) {
            return NativePurchaseResult.Failed("Play billing connect failed: ${connect.debugMessage}")
        }
        val productDetails = queryProductDetails(productId, productType)
            ?: return NativePurchaseResult.Failed("Product not found on Play: $productId")
        val activity = activityProvider()
            ?: return NativePurchaseResult.Failed("No foreground Activity to launch the billing flow")

        val detailsParams = BillingFlowParams.ProductDetailsParams.newBuilder()
            .setProductDetails(productDetails)
        if (productType == NativeProductType.SUBSCRIPTION) {
            // Plan change (PB-6): an existing active subscription means this is an UPGRADE or
            // DOWNGRADE, not a new purchase. Without replacement params Play either errors or
            // leaves the buyer paying for two subscriptions at once.
            //
            // Billing 8.3.0 moved this from flow-level BillingFlowParams.SubscriptionUpdateParams
            // (deprecated) onto the per-product params, keyed by the old PRODUCT ID rather than its
            // purchase token — so a multi-product flow can specify replacement per line.
            activeSubscriptionProductId(exceptProductId = productId)?.let { oldProductId ->
                detailsParams.setSubscriptionProductReplacementParams(
                    BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams
                        .newBuilder()
                        .setOldProductId(oldProductId)
                        // CHARGE_PRORATED_PRICE: the buyer is charged the difference now and the
                        // renewal date is preserved. The safe default for an upgrade; Play refuses
                        // it for a downgrade, which then surfaces as a normal billing error rather
                        // than a silent double-charge.
                        .setReplacementMode(
                            BillingFlowParams.ProductDetailsParams
                                .SubscriptionProductReplacementParams
                                .ReplacementMode.CHARGE_PRORATED_PRICE,
                        )
                        .build(),
                )
                logD("PlayBillingNativeClient") {
                    "plan change: replacing $oldProductId with $productId"
                }
            }

            // Pick the BEST eligible offer rather than whichever Play listed first. Play returns
            // base plan + trial + intro + developer offers in a meaningless order, so
            // `firstOrNull()` made a configured free trial apply or not by chance.
            val offers = productDetails.toNativeOffers()
            val best = selectBestOffer(offers)
                ?: return NativePurchaseResult.Failed("No subscription offer for $productId")
            detailsParams.setOfferToken(best.offerToken)
            logD("PlayBillingNativeClient") {
                "offer selected for $productId: id=${best.offerId} trialDays=${best.freeTrialDays}"
            }
        }

        val flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(detailsParams.build()))
            .apply {
                // Bind the receipt to the app user so the server can attribute it. Play requires
                // this to be non-identifying, so a hash — never the raw email — goes on the wire.
                appUserId?.let { setObfuscatedAccountId(obfuscate(it)) }
            }
            .build()

        val launch = billingClient.launchBillingFlow(activity, flowParams)
        if (launch.responseCode != BillingResponseCode.OK) {
            return NativePurchaseResult.Failed("launchBillingFlow failed: ${launch.debugMessage}")
        }

        // Correlate on the launched product and bound the wait: an uncorrelated `first()` could be
        // consumed by an unrelated concurrent callback, and an unbounded one suspends forever if
        // Play never calls back — pinning the paywall on Loading with no way out.
        val update = try {
            withTimeoutOrNull(PURCHASE_CALLBACK_TIMEOUT_MS) {
                rawUpdates.first { u ->
                    u.billingResult.responseCode != BillingResponseCode.OK ||
                        u.purchases.any { productId in it.products }
                }
            }
        } catch (e: TimeoutCancellationException) {
            null
        } ?: return NativePurchaseResult.Failed(
            "Play did not report a result for $productId in time — check your purchases and retry",
        )

        return when (update.billingResult.responseCode) {
            BillingResponseCode.OK -> {
                val purchase = update.purchases.firstOrNull { productId in it.products }
                    ?: update.purchases.firstOrNull()
                    ?: return NativePurchaseResult.Failed("Play reported OK with no Purchase")
                val native = purchase.toNativePurchase()
                // NOTE: no acknowledge here. The purchase is acknowledged in [finishPurchase],
                // AFTER the server records the entitlement — see the contract on that method.
                if (native.isPending) {
                    NativePurchaseResult.Pending(native)
                } else {
                    NativePurchaseResult.Success(native)
                }
            }
            BillingResponseCode.USER_CANCELED -> NativePurchaseResult.Cancelled
            else -> NativePurchaseResult.Failed("Purchase failed: ${update.billingResult.debugMessage}")
        }
    }

    /**
     * Acknowledge the purchase with Play. Called by the billing manager once the entitlement is
     * recorded server-side. An un-acknowledged purchase is auto-refunded by Play after 72 hours, so
     * a failure here is surfaced by leaving `isAcknowledged = false` on the next
     * [queryPurchases] — the reconcile loop retries it rather than losing it to a log line.
     */
    override suspend fun finishPurchase(purchase: NativePurchase) {
        if (purchase.isPending) return // nothing to acknowledge until payment clears
        ensureConnected()
        val ack = billingClient.acknowledgePurchase(
            AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.purchaseToken)
                .build(),
        )
        if (ack.responseCode != BillingResponseCode.OK) {
            logW("PlayBillingNativeClient") {
                "acknowledgePurchase failed (${ack.responseCode}): ${ack.debugMessage} — " +
                    "will retry on the next reconcile (Play auto-refunds after 72h)"
            }
        }
    }

    override suspend fun queryPurchases(): List<NativePurchase> {
        ensureConnected()
        // BOTH product types. Every query used to hardcode SUBS, so a lifetime/one-time purchase
        // was invisible to restore AND to the unacknowledged-purchase sweep — meaning Play would
        // auto-refund it after 72h and nothing would notice.
        return queryPurchasesOf(BillingClient.ProductType.SUBS) +
            queryPurchasesOf(BillingClient.ProductType.INAPP)
    }

    private suspend fun queryPurchasesOf(playType: String): List<NativePurchase> {
        val params = QueryPurchasesParams.newBuilder()
            .setProductType(playType)
            .build()
        val result = billingClient.queryPurchasesAsync(params)
        // PENDING purchases are RETAINED (flagged via NativePurchase.isPending) rather than
        // filtered away: dropping them is how cash/UPI and Ask-to-Buy buyers lost purchases that
        // were still legitimately in flight. The caller decides what a pending purchase means; it
        // is never an entitlement, but it is also never nothing.
        return result.purchasesList
            .filter {
                it.purchaseState == Purchase.PurchaseState.PURCHASED ||
                    it.purchaseState == Purchase.PurchaseState.PENDING
            }
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

    /**
     * Play billing storefront country — `getBillingConfig().countryCode`. This is where the Play
     * payment account lives (the true billing region), NOT the device UI locale. Lazily connects
     * like [purchase] does; returns null on connect failure or when Play reports no config.
     */
    override suspend fun storefrontCountry(): String? {
        val connect = ensureConnected()
        if (connect.responseCode != BillingResponseCode.OK) return null
        // billing-ktx v8 exposes suspend wrappers for queryProductDetails / queryPurchasesAsync /
        // acknowledgePurchase, but NOT for getBillingConfig — use the callback API wrapped in a
        // coroutine (same pattern as ensureConnected below).
        val config: BillingConfig? = suspendCancellableCoroutine { cont ->
            billingClient.getBillingConfigAsync(
                GetBillingConfigParams.newBuilder().build(),
            ) { billingResult, billingConfig ->
                if (cont.isActive) {
                    cont.resume(
                        if (billingResult.responseCode == BillingResponseCode.OK) billingConfig else null,
                    )
                }
            }
        }
        return config?.countryCode?.takeIf { it.isNotBlank() }
    }

    /**
     * The store's own localized SUBS price — the first pricing phase of the first subscription
     * offer (`formattedPrice` / `priceCurrencyCode` / `priceAmountMicros`). Null when the product
     * is not on Play, has no offer, or any field is missing.
     */
    override suspend fun nativeDisplayPrice(productId: String, productType: NativeProductType): NativeDisplayPrice? {
        val connect = ensureConnected()
        if (connect.responseCode != BillingResponseCode.OK) return null
        val productDetails = queryProductDetails(productId, productType) ?: return null

        if (productType == NativeProductType.ONE_TIME) {
            val offer = productDetails.oneTimePurchaseOfferDetails ?: return null
            val currency = offer.priceCurrencyCode.takeIf { it.isNotBlank() } ?: return null
            val formatted = offer.formattedPrice.takeIf { it.isNotBlank() } ?: return null
            return NativeDisplayPrice(formatted, currency, offer.priceAmountMicros)
        }

        // Advertise the price of the offer we will ACTUALLY purchase, and specifically its
        // recurring phase — quoting a free trial phase would display the price as "Free".
        val best = selectBestOffer(productDetails.toNativeOffers()) ?: return null
        val phase = best.recurringPhase ?: return null
        if (phase.currencyCode.isBlank() || phase.formattedPrice.isBlank()) return null
        return NativeDisplayPrice(
            formatted = phase.formattedPrice,
            currencyCode = phase.currencyCode,
            amountMicros = phase.priceAmountMicros,
        )
    }

    private suspend fun queryProductDetails(productId: String, productType: NativeProductType): ProductDetails? {
        val playType = productType.toPlayType()
        val params = QueryProductDetailsParams.newBuilder()
            .setProductList(
                listOf(
                    QueryProductDetailsParams.Product.newBuilder()
                        .setProductId(productId)
                        .setProductType(playType)
                        .build(),
                ),
            )
            .build()
        val result = billingClient.queryProductDetails(params)
        return result.productDetailsList?.firstOrNull()
    }

    /** Play `ProductDetails` → the device-free offer shape [selectBestOffer] ranks. */
    private fun ProductDetails.toNativeOffers(): List<NativeOffer> = subscriptionOfferDetails.orEmpty().map { offer ->
        NativeOffer(
            offerToken = offer.offerToken,
            offerId = offer.offerId,
            pricingPhases = offer.pricingPhases.pricingPhaseList.map { phase ->
                NativePricingPhase(
                    priceAmountMicros = phase.priceAmountMicros,
                    formattedPrice = phase.formattedPrice.orEmpty(),
                    currencyCode = phase.priceCurrencyCode.orEmpty(),
                    billingPeriodIso = phase.billingPeriod.orEmpty(),
                    billingCycleCount = phase.billingCycleCount,
                )
            },
        )
    }

    /**
     * The product id of an existing active subscription other than [exceptProductId] — the "old"
     * side of a plan change. Null when the buyer has no subscription to replace.
     */
    private suspend fun activeSubscriptionProductId(exceptProductId: String): String? =
        runCatching { queryPurchasesOf(BillingClient.ProductType.SUBS) }
            .getOrDefault(emptyList())
            .firstOrNull { !it.isPending && it.productId.isNotBlank() && it.productId != exceptProductId }
            ?.productId

    private fun NativeProductType.toPlayType(): String = when (this) {
        NativeProductType.SUBSCRIPTION -> BillingClient.ProductType.SUBS
        NativeProductType.ONE_TIME -> BillingClient.ProductType.INAPP
    }

    /**
     * Idempotent, serialized connect with bounded exponential backoff.
     *
     * The old version made exactly one attempt and relied on the next lazy call to retry, with no
     * delay. A Play Store update or a transient bind failure therefore surfaced as a hard failure
     * on the first post-disconnect call — the buyer saw "connect failed" and had to tap again.
     */
    private suspend fun ensureConnected(): BillingResult = connectMutex.withLock {
        if (closed) {
            return@withLock BillingResult.newBuilder()
                .setResponseCode(BillingResponseCode.SERVICE_DISCONNECTED)
                .setDebugMessage("PayCraft billing client is closed")
                .build()
        }
        if (billingClient.isReady) return@withLock okResult()

        var attempt = 0
        var last: BillingResult = okResult()
        while (attempt < MAX_CONNECT_ATTEMPTS) {
            last = connectOnce()
            if (last.responseCode == BillingResponseCode.OK || billingClient.isReady) {
                return@withLock last
            }
            attempt++
            if (attempt < MAX_CONNECT_ATTEMPTS) {
                delay(CONNECT_BACKOFF_BASE_MS shl (attempt - 1))
            }
        }
        logW("PlayBillingNativeClient") {
            "Play billing connect failed after $attempt attempts: ${last.debugMessage}"
        }
        last
    }

    private suspend fun connectOnce(): BillingResult = suspendCancellableCoroutine { cont ->
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

    /**
     * Release the Play connection. Call on SDK teardown — [BillingClient] holds a live service
     * binding, which was never released for the process lifetime.
     */
    fun close() {
        closed = true
        runCatching { billingClient.endConnection() }
    }

    @Volatile
    private var closed = false

    private fun okResult(): BillingResult = BillingResult.newBuilder().setResponseCode(BillingResponseCode.OK).build()

    private fun Purchase.toNativePurchase(): NativePurchase = NativePurchase(
        productId = products.firstOrNull().orEmpty(),
        purchaseToken = purchaseToken,
        originalTransactionId = orderId,
        purchaseTimeMillis = purchaseTime,
        isAutoRenewing = isAutoRenewing,
        packageName = packageName,
        isPending = purchaseState == Purchase.PurchaseState.PENDING,
        isAcknowledged = isAcknowledged,
    )

    private data class PurchasesUpdate(val billingResult: BillingResult, val purchases: List<Purchase>)

    private companion object {
        /**
         * How long to wait for Play's purchase callback before giving up. Generous — the user is
         * interacting with the Play sheet — but finite, so a callback that never arrives surfaces a
         * recoverable error instead of a permanently spinning paywall.
         */
        const val PURCHASE_CALLBACK_TIMEOUT_MS = 10 * 60 * 1000L

        /** Connect attempts before giving up, with a doubling delay between each. */
        const val MAX_CONNECT_ATTEMPTS = 3
        const val CONNECT_BACKOFF_BASE_MS = 500L

        /**
         * Play requires `obfuscatedAccountId` to be non-identifying and caps it at 64 chars, so the
         * app-user id is hashed rather than sent raw. Stable for a given id, which is all the
         * server needs to correlate.
         */
        fun obfuscate(appUserId: String): String {
            var h1 = -0x340d631b_00000000L
            for (c in appUserId) {
                h1 = (h1 xor c.code.toLong()) * 0x100000001b3L
            }
            var h2 = 0x84222325cbf29ce4uL.toLong()
            for (c in appUserId.reversed()) {
                h2 = (h2 xor c.code.toLong()) * 0x100000001b3L
            }
            return (h1.toULong().toString(16) + h2.toULong().toString(16)).take(64)
        }
    }
}

// ── Logging shim ─────────────────────────────────────────────────────────────
// Kermit was removed from PayCraft: it was a published transitive dependency doing nothing this
// SDK does not already do itself, and its version skewed against consumers (PayCraft 2.1.0 vs
// reels-downloader 2.0.8 crashed at launch on Logger$Companion.d$default; holding at the
// consumer's 2.0.5 broke this file with overload ambiguity). A dependency the SDK does not need
// cannot skew, so it is gone rather than pinned.
//
// These keep Kermit's exact call SHAPE — `logD(TAG) { "..." }` — so every existing trailing lambda
// is untouched and the message is still built lazily, only when logging is on.
private inline fun logD(tag: String, message: () -> String) =
    platformLog(PayCraftLogLevel.DEBUG, tag, message())

private inline fun logW(tag: String, message: () -> String) =
    platformLog(PayCraftLogLevel.WARN, tag, message())

private inline fun logE(tag: String, message: () -> String) =
    platformLog(PayCraftLogLevel.ERROR, tag, message())
