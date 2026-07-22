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
    /** `Product.products(for:)` → `product.purchase()`; resolves the signed JWS on success. */
    suspend fun purchase(productId: String): StoreKit2Outcome

    /**
     * `Transaction.currentEntitlements` — the verified, still-active transactions for the signed-in
     * Apple ID, each carrying its signed JWS representation (server re-verifies it, AC4).
     */
    suspend fun currentEntitlements(): List<StoreKit2Transaction>

    /** `AppStore.sync()` — force-refresh the App Store account transactions on restore (D7). */
    suspend fun sync()

    /** `AppStore.showManageSubscriptions(in:)` — the StoreKit2 native manage/cancel sheet (D7). */
    suspend fun showManageSubscriptions()
}

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
)

/** Outcome of a StoreKit2 `product.purchase()` call, mirrored from `Product.PurchaseResult`. */
sealed interface StoreKit2Outcome {
    data class Success(val transaction: StoreKit2Transaction) : StoreKit2Outcome

    /** `.userCancelled` — the shopper dismissed the sheet. */
    data object Cancelled : StoreKit2Outcome

    /** `.pending` (SCA/Ask-to-Buy) or a verification/StoreKit error, with a human message. */
    data class Failed(val message: String) : StoreKit2Outcome
}
