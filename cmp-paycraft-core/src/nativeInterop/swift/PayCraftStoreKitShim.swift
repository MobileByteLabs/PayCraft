//
//  PayCraftStoreKitShim.swift
//  PayCraft — SDK-INTERNAL StoreKit 2 shim.
//
//  This file is compiled INTO the PayCraft SDK (swiftc → static archive + generated ObjC header →
//  Kotlin/Native cinterop). It is never copied into, referenced by, or wired up by a consuming app.
//
//  WHY IT EXISTS AT ALL
//  StoreKit 2 (`Product`, `Transaction`, `AppStore`, `Storefront`) is pure Swift with async/await and
//  NO Objective-C surface, so Kotlin/Native cannot cinterop it directly. Some Swift must exist. The
//  only real question is who owns it.
//
//  WHY IT LOOKS LIKE THIS
//  The previous shim conformed to a Kotlin-exported protocol (`StoreKit2Bridge`) and returned
//  Kotlin-exported types (`StoreKit2Outcome`, `KotlinUnit`). That forced `import <SharedFramework>` —
//  and the shared framework's module name is chosen by the CONSUMER (ComposeApp, Shared, …). A file
//  that must be edited per consumer cannot ship inside a library, which is why every app ended up
//  hand-maintaining its own copy and why cappy's had already drifted 91 lines from canonical.
//
//  So the boundary is INVERTED. Nothing here imports a Kotlin module: every type crossing the line is
//  either Foundation or an @objc class declared right here. The shim therefore compiles standalone,
//  ships inside the SDK artifact, and the consumer's integration is commonMain only —
//  `PayCraft.initialize(apiKey:)` and nothing else.
//
//  THREADING: every entry point returns immediately and delivers on a completion block, because
//  Kotlin/Native cinterop cannot consume Swift async. Kotlin wraps each in suspendCancellableCoroutine.
//
import Foundation
import StoreKit
import UIKit

// MARK: - Value types crossing the Kotlin boundary
//
// Plain @objc classes, not the Kotlin-exported ones. cinterop renders each as a Kotlin class, so the
// adapter maps them to the store-agnostic `NativePurchase` / `NativeDisplayPrice` in commonMain.

@objc public final class PCTransaction: NSObject {
    @objc public let productId: String
    /// Signed JWS representation — the SDK never decides entitlement itself; the server re-verifies
    /// this against Apple. Surfaced as `NativePurchase.purchaseToken`.
    @objc public let jws: String
    @objc public let transactionId: String
    @objc public let originalTransactionId: String?
    @objc public let purchaseTimeMillis: Int64
    @objc public let isAutoRenewing: Bool
    /// Still in StoreKit's unfinished queue — the reconcile loop uses this to find purchases
    /// that still need finish() after the server recorded them.
    @objc public let isUnfinished: Bool

    init(productId: String, jws: String, transactionId: String,
         originalTransactionId: String?, purchaseTimeMillis: Int64, isAutoRenewing: Bool, isUnfinished: Bool) {
        self.productId = productId
        self.jws = jws
        self.transactionId = transactionId
        self.originalTransactionId = originalTransactionId
        self.purchaseTimeMillis = purchaseTimeMillis
        self.isAutoRenewing = isAutoRenewing
        self.isUnfinished = isUnfinished
    }
}

@objc public final class PCPrice: NSObject {
    @objc public let formatted: String
    @objc public let currencyCode: String
    @objc public let amountMicros: Int64

    init(formatted: String, currencyCode: String, amountMicros: Int64) {
        self.formatted = formatted
        self.currencyCode = currencyCode
        self.amountMicros = amountMicros
    }
}

/// Mirrors `NativePurchaseResult`. Int-backed so cinterop renders a Kotlin enum.
@objc public enum PCOutcomeKind: Int {
    case success = 0
    case cancelled = 1
    case pending = 2
    case failed = 3
}

@objc public final class PCPurchaseOutcome: NSObject {
    @objc public let kind: PCOutcomeKind
    @objc public let transaction: PCTransaction?
    @objc public let message: String?

    init(kind: PCOutcomeKind, transaction: PCTransaction? = nil, message: String? = nil) {
        self.kind = kind
        self.transaction = transaction
        self.message = message
    }
}

// MARK: - The shim

@objc public final class PayCraftStoreKitShim: NSObject {

    /// Retained deliberately — see `startTransactionUpdates`. Losing this reference silently ends all
    /// out-of-band purchase delivery, which is a class of bug that only shows up as "renewals stopped
    /// working" weeks later.
    private var updatesTask: Task<Void, Never>?

    @objc public override init() { super.init() }

    deinit { updatesTask?.cancel() }

    // MARK: Transaction.updates — the listener Apple requires for the process lifetime

    /// The ONLY delivery path for renewals, Ask-to-Buy approvals, family-sharing grants, refunds,
    /// revocations, and any transaction interrupted mid-purchase. Without it the SDK sees only what
    /// completes inside a foreground `purchase` call, and an unfinished transaction replays forever
    /// because nothing ever finishes it.
    @objc public func startTransactionUpdates(_ onTransaction: @escaping (PCTransaction) -> Void) {
        updatesTask = Task.detached { [weak self] in
            for await verification in Transaction.updates {
                guard let self = self else { return }
                guard let t = try? self.verified(verification) else { continue }
                onTransaction(await self.mapResolving(t, jws: verification.jwsRepresentation, isUnfinished: true))
            }
        }
    }

    // MARK: purchase

    @objc public func purchase(
        _ productId: String,
        appAccountToken: String?,
        completion: @escaping (PCPurchaseOutcome) -> Void
    ) {
        Task {
            do {
                guard let product = try await Product.products(for: [productId]).first else {
                    completion(PCPurchaseOutcome(kind: .failed, message: "Product not found: \(productId)"))
                    return
                }

                // Binds the transaction to the app user so an App Store Server Notification can be
                // attributed to them. StoreKit demands a UUID; Kotlin derives a stable one.
                var options: Set<Product.PurchaseOption> = []
                if let token = appAccountToken, let uuid = UUID(uuidString: token) {
                    options.insert(.appAccountToken(uuid))
                }

                switch try await product.purchase(options: options) {
                case .success(let verification):
                    let t = try self.verified(verification)
                    // DELIBERATELY NOT finishing here. finish() drops the transaction from StoreKit's
                    // unfinished queue; if the server call that follows then fails there is nothing
                    // left to retry against and the customer has paid for nothing. Kotlin calls
                    // finish() only after the entitlement is recorded server-side.
                    completion(PCPurchaseOutcome(kind: .success,
                                                 transaction: await self.mapResolving(t, jws: verification.jwsRepresentation, isUnfinished: true)))
                case .userCancelled:
                    completion(PCPurchaseOutcome(kind: .cancelled))
                case .pending:
                    // Ask to Buy awaiting a parent, or SCA in progress. NOT a failure — the approval
                    // arrives later on Transaction.updates.
                    completion(PCPurchaseOutcome(kind: .pending))
                @unknown default:
                    completion(PCPurchaseOutcome(kind: .failed, message: "Unknown StoreKit purchase result"))
                }
            } catch {
                completion(PCPurchaseOutcome(kind: .failed,
                                             message: "StoreKit purchase failed: \(error.localizedDescription)"))
            }
        }
    }

    // MARK: finish — called ONLY after the server has recorded the entitlement

    @objc public func finish(_ transactionId: String, completion: @escaping () -> Void) {
        Task {
            for await verification in Transaction.unfinished {
                guard let t = try? self.verified(verification) else { continue }
                if String(t.id) == transactionId {
                    await t.finish()
                    break
                }
            }
            completion()
        }
    }

    // MARK: currentEntitlements

    @objc public func currentEntitlements(completion: @escaping ([PCTransaction]) -> Void) {
        Task {
            var out: [PCTransaction] = []
            for await verification in Transaction.currentEntitlements {
                guard let t = try? self.verified(verification) else { continue }
                out.append(await self.mapResolving(t, jws: verification.jwsRepresentation, isUnfinished: false))
            }
            completion(out)
        }
    }

    // MARK: sync

    /// A sync failure is non-fatal for restore — `currentEntitlements` still reads the local receipt —
    /// so the error is reported rather than thrown, and the caller decides whether to surface it.
    @objc public func sync(completion: @escaping (String?) -> Void) {
        Task {
            do {
                try await AppStore.sync()
                completion(nil)
            } catch {
                completion(error.localizedDescription)
            }
        }
    }

    // MARK: manage subscriptions

    @objc public func showManageSubscriptions(completion: @escaping () -> Void) {
        Task { @MainActor in
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                // No foreground scene (backgrounded, or an extension). The account-level deep-link
                // is the scene-free path that always works.
                if let url = URL(string: "itms-apps://apps.apple.com/account/subscriptions") {
                    await UIApplication.shared.open(url)
                }
                completion()
                return
            }
            try? await AppStore.showManageSubscriptions(in: scene)
            completion()
        }
    }

    // MARK: storefront

    /// `Storefront.current` resolves the storefront the signed-in Apple ID actually buys from — the
    /// true billing region — independent of the device UI locale. An Indian buyer on an en-GB phone
    /// must see IN pricing, and this is the only API that says so.
    @objc public func storefrontCountry(completion: @escaping (String?) -> Void) {
        Task { completion(await Storefront.current?.countryCode) }
    }

    // MARK: display price

    @objc public func displayPrice(_ productId: String, completion: @escaping (PCPrice?) -> Void) {
        Task {
            guard let product = try? await Product.products(for: [productId]).first else {
                completion(nil)
                return
            }
            // `price` is a Decimal in the storefront currency; scale to integer micro-units.
            let micros = NSDecimalNumber(decimal: product.price * Decimal(1_000_000)).int64Value
            completion(PCPrice(formatted: product.displayPrice,
                               currencyCode: product.priceFormatStyle.currencyCode,
                               amountMicros: micros))
        }
    }

    // MARK: helpers

    private func verified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error): throw error
        case .verified(let safe): return safe
        }
    }

    /// Maps a verified transaction, RESOLVING the real renewal switch.
    ///
    /// `isAutoRenewing` must come from `RenewalInfo.willAutoRenew`, not `productType ==
    /// .autoRenewable`. The latter answers "is this the kind of product that renews", which stays
    /// true after the user cancels — so the paywall promised a charge that was never coming. Only
    /// the subscription's renewal info knows whether the NEXT period will actually be billed.
    private func mapResolving(_ t: StoreKit.Transaction, jws: String, isUnfinished: Bool) async -> PCTransaction {
        var willAutoRenew = false
        if t.productType == .autoRenewable, let groupId = t.subscriptionGroupID,
           let statuses = try? await Product.SubscriptionInfo.status(for: groupId) {
            for status in statuses {
                guard case .verified(let renewalInfo) = status.renewalInfo else { continue }
                if renewalInfo.currentProductID == t.productID {
                    willAutoRenew = renewalInfo.willAutoRenew
                    break
                }
            }
        }
        return PCTransaction(
            productId: t.productID,
            jws: jws,
            transactionId: String(t.id),
            originalTransactionId: String(t.originalID),
            purchaseTimeMillis: Int64(t.purchaseDate.timeIntervalSince1970 * 1000),
            isAutoRenewing: willAutoRenew,
            isUnfinished: isUnfinished
        )
    }
}
