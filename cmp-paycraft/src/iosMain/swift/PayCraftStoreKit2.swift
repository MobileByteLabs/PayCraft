//
//  PayCraftStoreKit2.swift
//  PayCraft — Phase 3 (E3) native iOS IAP client.
//
//  StoreKit2 is a Swift-only async/await framework with NO Objective-C surface, so Kotlin/Native
//  cannot cinterop it directly. This thin shim is the ONE place StoreKit2 (`Product`, `Transaction`,
//  `AppStore`) is called; it conforms to the Kotlin `StoreKit2Bridge` protocol (exported into the
//  shared KMP framework header) and is injected from the iOS app via
//  `paycraftStoreKit2BillingModule(bridge:)`. `StoreKit2NativeBillingClient` (Kotlin) consumes only
//  the protocol, keeping the reconciliation/restore code device-free and unit-testable. It is also
//  the one place `Storefront.current` (billing region) and `Product.displayPrice` (store-localized
//  price) are read for the paywall currency fix.
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

    /// Held for the process lifetime — see `startTransactionUpdates(listener:)`.
    private var updatesTask: Task<Void, Never>?

    public override init() { super.init() }

    /// Install PayCraft's StoreKit 2 support. Call ONCE at app start:
    ///
    /// ```swift
    /// PayCraftStoreKit2.install()
    /// ```
    ///
    /// Constructs the shim, hands it to the Kotlin SDK, and attaches `Transaction.updates` so
    /// renewals, Ask-to-Buy approvals, refunds and interrupted purchases are delivered from the
    /// moment the app launches — not just while a paywall happens to be open.
    ///
    /// Replaces the old three-step wiring (copy the file, edit its import, register a Koin module).
    @discardableResult
    public static func install() -> PayCraftStoreKit2 {
        let shim = PayCraftStoreKit2()
        PayCraftStoreKit.shared.register(bridge: shim)
        return shim
    }

    deinit { updatesTask?.cancel() }

    // MARK: purchase(productId:) -> StoreKit2Outcome

    public func purchase(
        productId: String,
        appAccountToken: String?,
        completionHandler: @escaping (StoreKit2Outcome?, Error?) -> Void
    ) {
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    completionHandler(StoreKit2OutcomeFailed(message: "Product not found: \(productId)"), nil)
                    return
                }

                // Bind the transaction to the app user so the App Store Server Notification can be
                // attributed. StoreKit requires a UUID here; Kotlin derives a stable one from the
                // app-user id.
                var options: Set<Product.PurchaseOption> = []
                if let token = appAccountToken, let uuid = UUID(uuidString: token) {
                    options.insert(.appAccountToken(uuid))
                }

                let result = try await product.purchase(options: options)
                switch result {
                case .success(let verification):
                    let transaction = try self.checkVerified(verification)
                    // DELIBERATELY NOT finishing here. finish() removes the transaction from
                    // StoreKit's unfinished queue; if the server call that follows fails, the
                    // purchase would be unrecoverable and the customer would have paid for
                    // nothing. Kotlin calls finish(transactionId:) once the entitlement is
                    // recorded server-side, and anything still unfinished is re-delivered by
                    // Transaction.updates on the next launch.
                    let mapped = await self.mapResolving(transaction, jws: verification.jwsRepresentation)
                    completionHandler(StoreKit2OutcomeSuccess(transaction: mapped), nil)
                case .userCancelled:
                    completionHandler(StoreKit2Outcome.Cancelled(), nil)
                case .pending:
                    // Ask to Buy awaiting a parent, or SCA in progress. NOT a failure — the
                    // approval arrives later on Transaction.updates.
                    completionHandler(StoreKit2Outcome.Pending(), nil)
                @unknown default:
                    completionHandler(StoreKit2OutcomeFailed(message: "Unknown StoreKit purchase result"), nil)
                }
            } catch {
                completionHandler(StoreKit2OutcomeFailed(message: "StoreKit purchase failed: \(error.localizedDescription)"), nil)
            }
        }
    }

    // MARK: startTransactionUpdates(listener:) — the listener Apple requires you to run

    /// Attaches `Transaction.updates` for the process lifetime.
    ///
    /// This is the ONLY delivery path for renewals, Ask-to-Buy approvals, family-sharing grants,
    /// refunds, revocations, and transactions interrupted mid-purchase. Without it the SDK sees
    /// only what completes inside a foreground `purchase()` call, and an unfinished transaction
    /// replays forever because nothing ever finishes it.
    public func startTransactionUpdates(listener: StoreKit2TransactionListener) {
        // Retained deliberately: this Task must outlive the call. Cancelling it would silently
        // stop all out-of-band purchase delivery.
        self.updatesTask = Task.detached { [weak self] in
            for await verification in Transaction.updates {
                guard let self = self else { return }
                guard let transaction = try? self.checkVerified(verification) else { continue }
                let mapped = await self.mapResolving(transaction, jws: verification.jwsRepresentation)
                listener.onTransaction(transaction: mapped)
            }
        }
    }

    // MARK: finish(transactionId:)

    /// Finishes the transaction — called from Kotlin ONLY after the server records the entitlement.
    public func finish(transactionId: String, completionHandler: @escaping (KotlinUnit?, Error?) -> Void) {
        Task {
            for await verification in Transaction.unfinished {
                guard let transaction = try? self.checkVerified(verification) else { continue }
                if String(transaction.id) == transactionId {
                    await transaction.finish()
                    break
                }
            }
            completionHandler(KotlinUnit(), nil)
        }
    }

    // MARK: currentEntitlements() -> [StoreKit2Transaction]

    public func currentEntitlements(completionHandler: @escaping ([StoreKit2Transaction]?, Error?) -> Void) {
        Task {
            var out: [StoreKit2Transaction] = []
            for await verification in Transaction.currentEntitlements {
                guard let transaction = try? self.checkVerified(verification) else { continue }
                out.append(await self.mapResolving(transaction, jws: verification.jwsRepresentation))
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

    // MARK: storefrontCountry() -> String?

    public func storefrontCountry(completionHandler: @escaping (String?, Error?) -> Void) {
        Task {
            // `Storefront.current` is async — it resolves the storefront the signed-in Apple ID
            // buys from (the true billing region), independent of the device UI locale.
            let storefront = await Storefront.current
            completionHandler(storefront?.countryCode, nil)
        }
    }

    // MARK: displayPrice(productId:) -> StoreKit2Price?

    public func displayPrice(productId: String, completionHandler: @escaping (StoreKit2Price?, Error?) -> Void) {
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    completionHandler(nil, nil)
                    return
                }
                // `price` is a Decimal in the storefront currency; scale to integer micro-units.
                let micros = NSDecimalNumber(decimal: product.price * Decimal(1_000_000)).int64Value
                completionHandler(
                    StoreKit2Price(
                        formatted: product.displayPrice,
                        currencyCode: product.priceFormatStyle.currencyCode,
                        amountMicros: micros
                    ),
                    nil
                )
            } catch {
                completionHandler(nil, error)
            }
        }
    }

    // MARK: introOffer(productId:) -> StoreKit2IntroOffer?

    /// Resolves the introductory offer AND this Apple ID's eligibility for it.
    ///
    /// `isEligibleForIntroOffer` is per-account and only Apple knows it — an Apple ID that already
    /// consumed the intro offer for this subscription group is not eligible again.
    public func introOffer(
        productId: String,
        completionHandler: @escaping (StoreKit2IntroOffer?, Error?) -> Void
    ) {
        Task {
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first,
                      let subscription = product.subscription,
                      let intro = subscription.introductoryOffer else {
                    completionHandler(nil, nil)
                    return
                }
                let eligible = await subscription.isEligibleForIntroOffer
                let days: Int32
                switch intro.paymentMode {
                case .freeTrial: days = Int32(self.days(in: intro.period))
                default:         days = 0
                }
                completionHandler(
                    StoreKit2IntroOffer(
                        isEligible: eligible,
                        freeTrialDays: days,
                        displayPrice: intro.displayPrice,
                        periodIso: self.iso(intro.period)
                    ),
                    nil
                )
            } catch {
                completionHandler(nil, error)
            }
        }
    }

    private func days(in period: Product.SubscriptionPeriod) -> Int {
        switch period.unit {
        case .day:   return period.value
        case .week:  return period.value * 7
        case .month: return period.value * 30
        case .year:  return period.value * 365
        @unknown default: return 0
        }
    }

    private func iso(_ period: Product.SubscriptionPeriod) -> String {
        switch period.unit {
        case .day:   return "P\(period.value)D"
        case .week:  return "P\(period.value)W"
        case .month: return "P\(period.value)M"
        case .year:  return "P\(period.value)Y"
        @unknown default: return ""
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

    /// Maps a verified transaction, resolving REAL renewal state from the subscription status.
    ///
    /// `willAutoRenew` cannot be read off `Transaction` — it lives on
    /// `Product.SubscriptionInfo.RenewalInfo`, which requires an async status lookup. Callers that
    /// already hold a renewal state pass it in; the rest get `nil` and fall back to the
    /// product-type heuristic ONLY for non-subscriptions, where it is exact.
    private func map(
        _ transaction: Transaction,
        jws: String,
        willAutoRenew: Bool? = nil,
        renewalState: String? = nil
    ) -> StoreKit2Transaction {
        StoreKit2Transaction(
            productId: transaction.productID,
            jwsRepresentation: jws,
            originalId: String(transaction.originalID),
            purchaseDateMillis: Int64(transaction.purchaseDate.timeIntervalSince1970 * 1000.0),
            // `productType == .autoRenewable` answers "is this the KIND of product that renews",
            // NOT "will it renew". Every auto-renewable subscription returned true — including one
            // the user cancelled yesterday that is running out its paid term — so the paywall told
            // cancelled subscribers they would be charged again. Real value or nothing.
            isAutoRenewing: willAutoRenew ?? false,
            transactionId: String(transaction.id),
            isUnfinished: true,
            renewalState: renewalState
        )
    }

    /// Resolves `willAutoRenew` + a coarse renewal state for a subscription transaction.
    ///
    /// Returns `(nil, nil)` for non-subscriptions and when the status lookup fails — callers then
    /// report "unknown" rather than guessing, because guessing here is what produced the bug.
    private func renewalInfo(for transaction: Transaction) async -> (Bool?, String?) {
        guard transaction.productType == .autoRenewable else { return (nil, nil) }
        guard let statuses = try? await Product.SubscriptionInfo.status(
            for: transaction.subscriptionGroupID ?? ""
        ) else { return (nil, nil) }

        for status in statuses {
            guard let renewal = try? self.checkVerified(status.renewalInfo),
                  let txn = try? self.checkVerified(status.transaction),
                  txn.originalID == transaction.originalID else { continue }

            let state: String
            switch status.state {
            case .subscribed:          state = "subscribed"
            case .inGracePeriod:       state = "in_grace_period"
            case .inBillingRetryPeriod: state = "billing_retry"
            case .expired:             state = "expired"
            case .revoked:             state = "revoked"
            default:                   state = "unknown"
            }
            return (renewal.willAutoRenew, state)
        }
        return (nil, nil)
    }

    /// Map with renewal state resolved. Used on every path that reports a subscription upward.
    private func mapResolving(_ transaction: Transaction, jws: String) async -> StoreKit2Transaction {
        let (willRenew, state) = await self.renewalInfo(for: transaction)
        return self.map(transaction, jws: jws, willAutoRenew: willRenew, renewalState: state)
    }
}
