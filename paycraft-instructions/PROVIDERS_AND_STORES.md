example-provenance: 518e84790cc2794f1cd4007182d72005ae07fe56

# PROVIDERS_AND_STORES.md — checkout lanes, provider adapters, store product sync

> Consumed by `/idea-paycraft` chain steps 2 and 6. Authored by `/paycraft-dev fold`.

## The lane decision is the compliance keystone

Every checkout entry (`PayCraft.checkout`, `checkoutWithProvider`) funnels through one pure,
unit-testable function so a browser fallback is structurally unreachable for native digital goods:

```kotlin
fun resolveCheckoutLane(
    platform: String,                 // "android" | "ios" | "macos" | "desktop" | "web"
    plan: BillingPlan,
    isDigital: Boolean = plan.isDigital,
): CheckoutLane
```

| Input | Lane |
|---|---|
| any **physical** product, any platform | `Web` |
| `android` + digital + non-blank `playProductId` | `NativePlay(productId)` |
| `android` + digital + blank/absent `playProductId` | **`Misconfigured`** — checkout BLOCKED |
| `ios`/`macos` + digital + non-blank `appStoreProductId` | `NativeStoreKit(productId)` |
| `ios`/`macos` + digital + blank/absent `appStoreProductId` | **`Misconfigured`** — checkout BLOCKED |
| `web`/`desktop` (no native store) + digital | `Web` |

`Misconfigured` sets a billing `Error` and **never opens a browser**. This is deliberate: a
misconfigured product is not a licence to route a native-store digital purchase to a web payment
page. On Android that steering is the "leads users to a payment method other than Google Play's
billing system" violation that got a shipped consumer app flagged and restricted; on iOS it is an
App Store Review Guideline 3.1.1 rejection.

**So `Misconfigured` is never an acceptable end state for `/idea-paycraft`.** Reaching it means the
store product id is missing from `SuiteConfig`, which is a product-sync gap to heal (below), not a
lane to fall back from.

## Native store lanes

### Google Play (Android)

- Billing library **9.1.0**. Client `PlayBillingNativeClient.android.kt`.
- Context + Activity captured automatically by `PayCraftInitializer` (androidx-startup).
- Plan change / upgrade uses `BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams`
  (`setOldProductId`, `setReplacementMode`), not the removed pre-v8 proration API.
- Pending purchases are enabled; `PurchaseState.PENDING` surfaces as `BillingState.PaymentPending`.
- The buyer's stable app-user-id is passed as `obfuscatedAccountId`.
- Grant path: the SDK POSTs the `purchaseToken` to the `register-play-purchase` edge function, which
  re-fetches truth from the Play Developer API. Client claims are never trusted.

### StoreKit 2 (iOS / macOS)

- Swift shim `PayCraftStoreKit2.swift` bridged by `StoreKit2Bridge.kt` /
  `StoreKit2NativeBillingClient.ios.kt`; opt-in Koin module `paycraftStoreKit2BillingModule`.
- Shim surface: `startTransactionUpdates(listener:)` (so `Transaction.updates` reaches the SDK),
  `finish(transactionId:)`, `introOffer(productId:)`.
- A transaction is finished **only after** the entitlement is reconciled — finishing early loses the
  purchase if reconciliation fails.
- `appAccountToken` carries the stable app-user-id.
- There is no client-facing StoreKit grant endpoint: truth arrives via the Apple App Store Server
  Notifications webhook, so success reconciles through the normal server refresh path.

### `NativeBillingClient` (the common contract)

```kotlin
val purchaseUpdates: Flow<NativePurchase>
suspend fun purchase(productId: String, appUserId: String? = null,
                     productType: NativeProductType = NativeProductType.SUBSCRIPTION): NativePurchaseResult
suspend fun finishPurchase(purchase: NativePurchase)
suspend fun queryPurchases(): List<NativePurchase>
suspend fun sync()
suspend fun restore(): List<NativePurchase>
suspend fun manageSubscription(productId: String?)
suspend fun storefrontCountry(): String?
suspend fun nativeDisplayPrice(productId: String, productType: NativeProductType): NativeDisplayPrice?
```

`NativePurchaseResult` is `Success` | `Pending` | `Failed`. `NativePurchase` carries `productId`,
`purchaseToken`, `originalTransactionId`, `purchaseTimeMillis`, `isAutoRenewing`, `packageName`,
`isPending`, `isAcknowledged`.

**Offer selection.** `selectBestOffer(offers)` ranks by longest free trial, then lowest first charge,
then a stable tie-break — so a subscription with several base-plan offers presents the best one
rather than an arbitrary index. `NativePricingPhase.isFree` identifies the trial phase;
`freeTrialDays` derives from the ISO-8601 billing period.

**Storefront drives currency.** `storefrontCountry()` is the true billing region and is folded into
the `/config` request at fetch time, after the synchronous `initialize` has already picked a
provisional country from override → device region → `US`.

## Web providers

`interface PaymentProvider { name; getCheckoutUrl(plan, email?); getManageUrl(email); webhookFunctionName }`.

Shipped adapters: Stripe, Razorpay, Paddle, PayPal, Paystack, Flutterwave, LemonSqueezy, Midtrans,
BTCPay, Custom. `ProviderCanonicalMapper` normalises each provider's status vocabulary onto the
canonical entitlement states.

The app **never** talks to a provider directly — it only reads Supabase; webhooks keep Supabase in
sync. A provider adapter exists only to produce checkout and manage URLs.

`ProviderDto` carries `testPaymentLinksBySku` and `livePaymentLinksBySku`; `PayCraft.mode` (derived
from the `pk_` key prefix) selects which map is read, and `supportedLocales` / `platform` scope a
provider to where it is valid.

## Store-side product sync

`SuiteConfig.products[]` is the SoT the app reads, but the *store* is where the money moves. A
product is only fully configured when all three agree:

| Layer | Field |
|---|---|
| PayCraft dashboard | `ProductDto.sku`, `type`, `interval`, `basePriceCents`/`baseCurrency` |
| Google Play Console | a subscription/base-plan whose id equals `ProductDto.playProductId` |
| App Store Connect | a subscription whose id equals `ProductDto.appStoreProductId` |

Failure signature per layer:

- Missing dashboard product → the plan is absent from the paywall entirely.
- Missing `playProductId`/`appStoreProductId` → `CheckoutLane.Misconfigured`, checkout blocked.
- Id present in the dashboard but absent in the store → the store query returns no product; native
  display price is null and the purchase call fails at the store.
- Product exists but is not active/approved in the store → same shape as absent; check the store's
  own status, not just the id.

`/idea-paycraft` treats "resolves to a lane that is not `Misconfigured`, on every platform the app
ships" as the pass condition for this step, and heals a missing id at its source (the dashboard
product row), never by relaxing the lane decision.
