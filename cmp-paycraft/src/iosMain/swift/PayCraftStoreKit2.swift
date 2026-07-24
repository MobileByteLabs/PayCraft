//
//  PayCraftStoreKit2.swift
//  PayCraft — Phase 3 (E3) native iOS IAP client.
//
//  StoreKit2 is a Swift-only async/await framework with NO Objective-C surface, so Kotlin/Native
//  cannot cinterop it directly. This thin shim is the ONE place StoreKit2 (`Product`, `Transaction`,
//  `AppStore`) is called; it conforms to the Kotlin `StoreKit2Bridge` protocol (exported into the
//  shared KMP framework header) and is injected from the iOS app via
//  `paycraftStoreKit2BillingModule(bridge:)`. `StoreKit2NativeBillingClient` (Kotlin) consumes only
//  the protocol, keeping the reconciliation/restore code device-free and unit-testable.
//
//  WIRING (consuming iOS app):
//    1. Add this file to the app's Xcode target (it needs the app's StoreKit entitlement).
//    2. Replace `import PayCraftShared` below with your shared-framework module name (the one that
//       exports the Kotlin `StoreKit2Bridge` protocol — e.g. `Shared`, `ComposeApp`, `PayCraft`).
//    3. At startup:  KoinKt.doInitKoinWith(module: PayCraftDIKt.paycraftStoreKit2BillingModule(
//                        bridge: PayCraftStoreKit2()))
//
//  Kotlin `suspend fun` exports as a Swift `…(…, completionHandler:)` method; each async StoreKit2
//  call is wrapped in a `Task` and the result handed back through the completion handler.
//
//  Requires iOS 15+ (StoreKit2 baseline). Set the module's iOS deployment target to 15.0 or higher.
//

import Foundation
import StoreKit

// Replace with your shared KMP framework's module name (the one exporting `StoreKit2Bridge`).
import PayCraftShared

@available(iOS 15.0, *)
@objcMembers
public final class PayCraftStoreKit2: NSObject, StoreKit2Bridge {

    public override init() { super.init() }

    // MARK: purchase(productId:) -> StoreKit2Outcome

    public func purchase(productId: String, completionHandler: @escaping (StoreKit2Outcome?, Error?) -> Void) {
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    completionHandler(StoreKit2OutcomeFailed(message: "Product not found: \(productId)"), nil)
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    let transaction = try self.checkVerified(verification)
                    // Finishing the transaction tells StoreKit it has been delivered/recorded.
                    await transaction.finish()
                    completionHandler(
                        StoreKit2OutcomeSuccess(transaction: self.map(transaction, jws: verification.jwsRepresentation)),
                        nil
                    )
                case .userCancelled:
                    completionHandler(StoreKit2Outcome.Cancelled(), nil)
                case .pending:
                    completionHandler(StoreKit2OutcomeFailed(message: "Purchase pending (Ask to Buy / SCA)"), nil)
                @unknown default:
                    completionHandler(StoreKit2OutcomeFailed(message: "Unknown StoreKit purchase result"), nil)
                }
            } catch {
                completionHandler(StoreKit2OutcomeFailed(message: "StoreKit purchase failed: \(error.localizedDescription)"), nil)
            }
        }
    }

    // MARK: currentEntitlements() -> [StoreKit2Transaction]

    public func currentEntitlements(completionHandler: @escaping ([StoreKit2Transaction]?, Error?) -> Void) {
        Task {
            var out: [StoreKit2Transaction] = []
            for await verification in Transaction.currentEntitlements {
                guard let transaction = try? self.checkVerified(verification) else { continue }
                out.append(self.map(transaction, jws: verification.jwsRepresentation))
            }
            completionHandler(out, nil)
        }
    }

    // MARK: sync()  ->  AppStore.sync()

    public func sync(completionHandler: @escaping (KotlinUnit?, Error?) -> Void) {
        Task {
            do {
                try await AppStore.sync()
                completionHandler(KotlinUnit(), nil)
            } catch {
                // A sync failure is non-fatal for restore (currentEntitlements still reads the local
                // receipt) — report the error so the caller can surface it if desired.
                completionHandler(nil, error)
            }
        }
    }

    // MARK: showManageSubscriptions()

    public func showManageSubscriptions(completionHandler: @escaping (KotlinUnit?, Error?) -> Void) {
        Task { @MainActor in
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                completionHandler(KotlinUnit(), nil)
                return
            }
            do {
                try await AppStore.showManageSubscriptions(in: scene)
                completionHandler(KotlinUnit(), nil)
            } catch {
                completionHandler(nil, error)
            }
        }
    }

    // MARK: - Helpers

    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let safe):
            return safe
        }
    }

    private func map(_ transaction: Transaction, jws: String) -> StoreKit2Transaction {
        StoreKit2Transaction(
            productId: transaction.productID,
            jwsRepresentation: jws,
            originalId: String(transaction.originalID),
            purchaseDateMillis: Int64(transaction.purchaseDate.timeIntervalSince1970 * 1000.0),
            isAutoRenewing: transaction.productType == .autoRenewable
        )
    }
}
