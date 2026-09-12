package com.mobilebytelabs.paycraft.billing

/**
 * Kotlin/Swift boundary to the **Swift-only StoreKit2 API**.
 *
 * StoreKit2 (`Product`, `Transaction`, `AppStore`) is a pure-Swift, `async`/`await` framework with
 * NO Objective-C surface, so Kotlin/Native cannot cinterop it directly. The idiomatic KMP bridge is
 * therefore a thin Swift shim that conforms to THIS Kotlin protocol (exported to the framework
 * header) and is injected from the consuming iOS app. The Swift shim
 * (`iosMain/swift/PayCraftStoreKit2.swift`) is the single place `Transaction.currentEntitlements`,
 * `AppStore.sync()`, `Product.products`, and `Product.purchase()` are called; [StoreKit2NativeBillingClient]
 * consumes only this device-free protocol so it stays fully unit-testable.
 *
 * Every method is `suspend` — the K/N Obj-C export renders each as a Swift `…completionHandler:`
 * variant, which the Swift shim satisfies by wrapping its StoreKit2 `async` calls in a `Task`.
 */
interface StoreKit2Bridge {
    /**
     * Attach `Transaction.updates` — the listener Apple requires an app to run for its whole
     * lifetime.
     *
     * StoreKit2 delivers renewals, Ask-to-Buy approvals, family-sharing grants, refunds,
     * revocations, and any transaction interrupted mid-purchase through this stream and NOWHERE
     * else. Without it the SDK sees only transactions that complete inside a foreground
     * `purchase()` call, and an interrupted purchase is never finished so StoreKit replays it
     * forever.
     *
     * Called once at SDK init. The shim must keep the `Task` alive for the process lifetime.
     */
    fun startTransactionUpdates(listener: StoreKit2TransactionListener)

    /**
     * `Transaction.finish()` for [transactionId].
     *
     * Split out of [purchase] deliberately: the shim used to finish the transaction the instant it
     * verified, BEFORE the server had ever seen the receipt. Finishing removes it from StoreKit's
     * unfinished queue, so a server call that then failed left the customer paid-up with no
     * entitlement and nothing to retry against.
     */
    suspend fun finish(transactionId: String)

    /** `Product.products(for:)` → `product.purchase()`; resolves the signed JWS on success. */
    suspend fun purchase(productId: String, appAccountToken: String?): StoreKit2Outcome

    /**
     * `Transaction.currentEntitlements` — the verified, still-active transactions for the signed-in
     * Apple ID, each carrying its signed JWS representation (server re-verifies it, AC4).
     */
    suspend fun currentEntitlements(): List<StoreKit2Transaction>

    /** `AppStore.sync()` — force-refresh the App Store account transactions on restore (D7). */
    suspend fun sync()

    /** `AppStore.showManageSubscriptions(in:)` — the StoreKit2 native manage/cancel sheet (D7). */
    suspend fun showManageSubscriptions()

    /**
     * `Storefront.current?.countryCode` — the App Store storefront the signed-in Apple ID buys
     * from (the true billing region). Null when unavailable.
     */
    suspend fun storefrontCountry(): String?

    /**
     * `Product.products(for:)` → the store's own localized price for [productId]:
     * `Product.displayPrice` + `priceFormatStyle.currencyCode` + `price` (Decimal → micros).
     * Null when the product is unavailable in the current storefront.
     */
    suspend fun displayPrice(productId: String): StoreKit2Price?

    /**
     * `Product.SubscriptionInfo.isEligibleForIntroOffer` for THIS Apple ID, plus the offer's terms.
     *
     * Eligibility is per-account and Apple is the only source of truth for it: an Apple ID that
     * already used the introductory offer for a subscription group is not eligible again. Without
     * this the paywall could only guess — so trial copy was either shown to ineligible buyers
     * (who then saw a charge they were not expecting) or withheld from eligible ones (losing the
     * conversion the trial was configured for).
     *
     * Null when the product has no introductory offer, or when eligibility cannot be resolved.
     */
    suspend fun introOffer(productId: String): StoreKit2IntroOffer?
}

/**
 * An introductory offer and whether the signed-in Apple ID can actually use it.
 *
 * @param isEligible Apple's own per-account answer. NEVER inferred locally.
 * @param freeTrialDays days of free trial, or 0 when the offer is a discounted intro price.
 * @param displayPrice store-formatted price charged during the intro period ("Free" / "₹99").
 * @param periodIso ISO-8601 duration of the intro period (`P1W`, `P1M`).
 */
data class StoreKit2IntroOffer(
    val isEligible: Boolean,
    val freeTrialDays: Int,
    val displayPrice: String,
    val periodIso: String,
)

/**
 * One StoreKit2 `Product`'s localized price, flattened to device-free primitives so `commonMain`
 * pricing can consume it without a StoreKit dependency. Mirrors
 * [com.mobilebytelabs.paycraft.billing.NativeDisplayPrice].
 *
 * @param formatted     `Product.displayPrice` — the store-formatted localized string.
 * @param currencyCode  `Product.priceFormatStyle.currencyCode` — ISO 4217.
 * @param amountMicros  `Product.price` (Decimal) scaled to micro-units (× 1_000_000).
 */
data class StoreKit2Price(val formatted: String, val currencyCode: String, val amountMicros: Long)

/**
 * One verified StoreKit2 `Transaction`, flattened to device-free primitives so `commonMain`
 * reconciliation can consume it without a StoreKit dependency.
 *
 * @param jwsRepresentation the signed JWS the server re-verifies with Apple's public keys (AC4).
 * @param originalId Apple `originalID` — the cross-device/cross-platform restore anchor.
 */
data class StoreKit2Transaction(
    val productId: String,
    val jwsRepresentation: String,
    val originalId: String,
    val purchaseDateMillis: Long,
    val isAutoRenewing: Boolean,
    /**
     * Apple `Transaction.id` — the per-transaction id [StoreKit2Bridge.finish] needs.
     * Distinct from [originalId], which is stable across the whole renewal chain.
     */
    val transactionId: String = "",
    /** This transaction is still unfinished (server has not confirmed the entitlement yet). */
    val isUnfinished: Boolean = true,
    /**
     * Coarse subscription renewal state from `Product.SubscriptionInfo.Status.state` —
     * `subscribed | in_grace_period | billing_retry | expired | revoked | unknown`, or null for a
     * non-subscription (or when the status lookup failed).
     *
     * Without this the SDK could not tell dunning from churn on iOS: a subscriber in Apple's
     * billing-retry window looked identical to one who had simply expired.
     */
    val renewalState: String? = null,
)

/**
 * Receives every transaction StoreKit reports outside a foreground purchase — see
 * [StoreKit2Bridge.startTransactionUpdates]. Implemented in Kotlin, invoked from the Swift shim.
 */
fun interface StoreKit2TransactionListener {
    fun onTransaction(transaction: StoreKit2Transaction)
}

/** Outcome of a StoreKit2 `product.purchase()` call, mirrored from `Product.PurchaseResult`. */
sealed interface StoreKit2Outcome {
    data class Success(val transaction: StoreKit2Transaction) : StoreKit2Outcome

    /** `.userCancelled` — the shopper dismissed the sheet. */
    data object Cancelled : StoreKit2Outcome

    /**
     * `.pending` — Ask to Buy awaiting a parent's approval, or SCA in progress. NOT a failure:
     * the approval arrives later on `Transaction.updates`. Reporting it as an error told a child
     * waiting on a parent that their purchase had failed.
     */
    data object Pending : StoreKit2Outcome

    /** A verification failure or StoreKit error, with a human message. */
    data class Failed(val message: String) : StoreKit2Outcome
}
