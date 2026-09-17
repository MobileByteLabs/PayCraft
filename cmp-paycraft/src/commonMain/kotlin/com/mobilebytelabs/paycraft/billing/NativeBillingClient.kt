package com.mobilebytelabs.paycraft.billing

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow

/**
 * One native purchase as reported by StoreKit2 (`Transaction`) or Play Billing
 * (`Purchase`). Device-free value object so the reconciliation + restore code in
 * `commonMain` can reason about store receipts without pulling a platform SDK.
 *
 * @param originalTransactionId Apple `originalID` / Play linked purchase token — the id the
 *   server API re-fetch (D5) keys on, and the anchor for cross-platform restore.
 */
data class NativePurchase(
    val productId: String,
    val purchaseToken: String,
    val originalTransactionId: String?,
    val purchaseTimeMillis: Long,
    val isAutoRenewing: Boolean,
    /**
     * Owning app package (Play `Purchase.getPackageName()`). Needed by the server-side
     * `register-play-purchase` edge function to re-fetch truth from the Play Developer API
     * (`purchases.subscriptionsv2.get` is keyed by package + token). Non-null on Android; null
     * on stores where package is not part of the receipt (StoreKit2).
     */
    val packageName: String? = null,
    /**
     * The store accepted the order but payment has NOT cleared yet — Play `PurchaseState.PENDING`
     * (cash / UPI-mandate / Ask-to-Buy family approval) or StoreKit `.pending` (Ask to Buy / SCA).
     *
     * A pending purchase is NOT an entitlement and NOT a failure. It can take days to clear, and
     * when it does it arrives on [NativeBillingClient.purchaseUpdates] rather than as the return
     * value of the original [NativeBillingClient.purchase] call. Treating it as a failure — which
     * the SDK did before — tells a buyer their payment failed while their money is in flight.
     */
    val isPending: Boolean = false,
    /**
     * The purchase has been durably recorded with the store (Play `isAcknowledged`, StoreKit
     * `finish()`ed). An UNACKNOWLEDGED Play purchase is auto-refunded after 72 hours, so this is
     * the flag the reconcile loop uses to find purchases that still need
     * [NativeBillingClient.finishPurchase] — including ones whose first attempt failed.
     *
     * Defaults to `true` so stores without the concept never look unfinished.
     */
    val isAcknowledged: Boolean = true,
)

/**
 * The store's OWN localized price for a product, as reported by Google Play
 * (`ProductDetails` → `formattedPrice` / `priceCurrencyCode` / `priceAmountMicros`) or StoreKit2
 * (`Product.displayPrice` / currency / `price`). This is the truth the shopper is actually charged
 * in the native billing lane — it already reflects the store storefront (the region where the
 * user's Play/Apple payment account lives), not the device UI locale or the cloud `/config` price.
 *
 * Device-free value object so `commonMain` pricing code can prefer the native price over the
 * cloud-resolved one for native lanes (Android Play Billing / iOS StoreKit2).
 *
 * @param formatted     Store-formatted, localized price string (e.g. "₹799.00", "$9.99").
 * @param currencyCode  ISO 4217 currency of the store price (e.g. "INR", "USD").
 * @param amountMicros  Price in micro-units of the currency (1_000_000 micros = 1 unit).
 */
data class NativeDisplayPrice(val formatted: String, val currencyCode: String, val amountMicros: Long)

/** Outcome of a native purchase attempt. */
sealed interface NativePurchaseResult {
    data class Success(val purchase: NativePurchase) : NativePurchaseResult

    /** User dismissed the store sheet before paying. */
    data object Cancelled : NativePurchaseResult

    /**
     * The store accepted the order but payment has not cleared — see [NativePurchase.isPending].
     * The resolution arrives later on [NativeBillingClient.purchaseUpdates]; the caller should show
     * a "payment pending" state rather than an error, and must NOT grant the entitlement yet.
     */
    data class Pending(val purchase: NativePurchase) : NativePurchaseResult

    data class Failed(val message: String) : NativePurchaseResult
}

/**
 * Native in-app-purchase client contract (D8 KMP `expect/actual` — this is the DEVICE-FREE
 * `commonMain` interface; the `androidMain` (Play Billing v8) and `iosMain` (StoreKit2)
 * `actual` implementations land in Phase 3 / the platform layer).
 *
 * The Store5 cache + [com.mobilebytelabs.paycraft.core.EntitlementRepository] restore/cancel
 * orchestration compile against THIS interface only:
 *  - [sync] re-links store receipts to the signed-in store account
 *    (StoreKit `AppStore.sync()` / Play `queryPurchasesAsync()`) — the restore trigger (D7).
 *  - [queryPurchases] / [restore] surface the current native purchases so the engine can
 *    reconcile them against the stable app-user-id.
 *  - [manageSubscription] opens the store's own subscription centre — stores FORBID
 *    programmatic cancel, so cancel of a native subscription is a deep-link, never an API call
 *    (Play sub-center URL on Android, StoreKit `showManageSubscriptions(in:)` on iOS) (D7).
 *
 * Non-native platforms (jvm / desktop / wasmJs / js / macos — D13 "web checkout only") bind
 * [WebCheckoutNativeBillingClient], whose native operations are correct no-ops.
 */
interface NativeBillingClient {
    /**
     * Every purchase this client observes, whoever started it.
     *
     * The store reports purchases that no in-flight [purchase] call is awaiting: a renewal, a promo
     * code redeemed in the store app, a deferred/pending payment clearing days later, an Ask-to-Buy
     * approval, a purchase that completed while the app was backgrounded, a family-sharing grant, a
     * refund or revocation. Before this stream existed those callbacks were dropped on the floor —
     * the buyer paid and was never upgraded until some later manual refresh.
     *
     * The billing manager collects this for the SDK's lifetime and reconciles every emission
     * through the same server path as a foreground purchase.
     */
    val purchaseUpdates: Flow<NativePurchase>

    /**
     * Launch the store purchase flow for [productId].
     *
     * @param appUserId the SDK's stable buyer identity, handed to the store so the receipt carries
     *   it (Play `obfuscatedAccountId`, StoreKit `appAccountToken`). Without it the server has no
     *   way to bind a store receipt to an app user, which is what cross-device restore, multi-account
     *   detection and fraud checks all rest on. Null only when no identity is resolvable yet.
     */
    suspend fun purchase(
        productId: String,
        appUserId: String? = null,
        productType: NativeProductType = NativeProductType.SUBSCRIPTION,
    ): NativePurchaseResult

    /**
     * Durably record [purchase] with the store — Play `acknowledgePurchase`, StoreKit
     * `Transaction.finish()`.
     *
     * MUST be called only AFTER the entitlement is safely recorded server-side. Finishing first is
     * a lost purchase: the store drops it from the unfinished queue, so if the server call then
     * fails there is nothing left to retry against and the customer has paid for nothing.
     *
     * Idempotent — safe to call on an already-finished purchase.
     */
    suspend fun finishPurchase(purchase: NativePurchase)

    /**
     * Current store-side purchases for the signed-in store account (no network re-link).
     *
     * Covers BOTH product types. Every query used to hardcode Play's `SUBS`, so a one-time /
     * lifetime purchase was invisible to restore and to the unfinished-purchase sweep.
     */
    suspend fun queryPurchases(): List<NativePurchase>

    /**
     * Re-link store receipts to the signed-in store account — StoreKit2 `AppStore.sync()` /
     * Play `queryPurchasesAsync()`. Called at the start of a restore so a receipt bought on
     * another device/platform surfaces before the server reconcile (D7, AC5).
     */
    suspend fun sync()

    /** Force a store-receipt restore and return the recovered purchases. */
    suspend fun restore(): List<NativePurchase>

    /**
     * Open the store-native subscription-management surface (Play subscriptions centre /
     * StoreKit `showManageSubscriptions`). [productId] deep-links to the specific plan where
     * the store supports it; null opens the account subscription list.
     */
    suspend fun manageSubscription(productId: String?)

    /**
     * The store's billing storefront country (ISO 3166-1 alpha-2) — Play
     * `getBillingConfig().countryCode` / StoreKit `Storefront.current?.countryCode`. This is the
     * region the user's Play/Apple PAYMENT ACCOUNT lives in, which is the true billing region for
     * native lanes and takes precedence over the device UI locale (an Indian buyer on an en-GB
     * phone should see IN pricing, not GB). Null when the store cannot report it.
     */
    suspend fun storefrontCountry(): String?

    /**
     * The store's OWN localized price for [productId] — Play `ProductDetails.formattedPrice` /
     * StoreKit `Product.displayPrice`. Preferred over the cloud `/config` price for native lanes
     * so the paywall shows exactly what the store will charge (e.g. ₹799 from the IN storefront).
     * Null when the product/price is unavailable on this store.
     */
    suspend fun nativeDisplayPrice(
        productId: String,
        productType: NativeProductType = NativeProductType.SUBSCRIPTION,
    ): NativeDisplayPrice?
}

/**
 * Default [NativeBillingClient] for platforms with NO native store (jvm / desktop / wasmJs /
 * js / macos — D13). There is genuinely nothing to purchase, query, sync, restore, or manage
 * natively on these targets — subscriptions there flow through web checkout + the PSP-API
 * cancel path — so every native operation is a correct no-op, NOT a stub.
 *
 * Android/iOS consumers override this Koin binding with the Phase-3 `actual` client.
 */
class WebCheckoutNativeBillingClient : NativeBillingClient {
    // intentional-noop: no native store → no store callbacks will ever arrive on this platform.
    override val purchaseUpdates: Flow<NativePurchase> = emptyFlow()

    // intentional-noop: no native store exists on web-checkout platforms (D13); purchase is
    // impossible here, callers route to web checkout instead.
    override suspend fun purchase(
        productId: String,
        appUserId: String?,
        productType: NativeProductType,
    ): NativePurchaseResult = NativePurchaseResult.Failed("No native store on this platform — use web checkout")

    // intentional-noop: no native store → nothing to acknowledge or finish.
    override suspend fun finishPurchase(purchase: NativePurchase) = Unit

    // intentional-noop: no native store → no native purchases to enumerate.
    override suspend fun queryPurchases(): List<NativePurchase> = emptyList()

    // intentional-noop: no native store receipts to re-link on this platform.
    override suspend fun sync() = Unit

    // intentional-noop: no native store receipts to restore on this platform.
    override suspend fun restore(): List<NativePurchase> = emptyList()

    // intentional-noop: no native subscription centre on this platform; PSP cancel is used.
    override suspend fun manageSubscription(productId: String?) = Unit

    // intentional-noop: no native store → no store storefront; country falls through to the
    // device region / cloud locale in CurrencyResolver.
    override suspend fun storefrontCountry(): String? = null

    // intentional-noop: no native store → no store-localized price; the cloud /config price is used.
    override suspend fun nativeDisplayPrice(productId: String, productType: NativeProductType): NativeDisplayPrice? =
        null
}
