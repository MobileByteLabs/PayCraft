example-provenance: 9cb5162c248fb9426d460f2328ffda6882c29462

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

**The platform no longer picks the store.** The decision reads `BillingPlan.storeBinding`, which
`/config` resolved server-side from `tenant_routing_rules` for the platform named in the
`x-paycraft-platform` request header:

| Input | Lane |
|---|---|
| any **physical** product, any platform | `Web` |
| digital + binding provider `google_play` | `NativePlay(binding.productId)` |
| digital + binding provider `app_store` | `NativeStoreKit(binding.productId)` |
| digital + any other provider (`stripe_card`, `razorpay`, `cashfree`, …) | `Web` — the binding's id is that PSP's price/plan id |
| digital + **no binding at all** | **`Misconfigured`** — checkout BLOCKED |

> **This replaced a hardcoded `android → Play` / `ios → StoreKit` mapping**, which made the
> dashboard's Platform-providers page decorative: a tenant whose iOS primary was set to Stripe still
> went to StoreKit, and one whose Android primary was Stripe still went to Play. Routing is now a
> tenant decision, made once on the server, rather than a client assumption. `platform` is retained
> only for the physical-goods short-circuit and for diagnostics.
>
> It also replaced the `ProductDto.playProductId` / `appStoreProductId` **pair** with one
> `StoreBinding(provider, productId)`. Any integration or verification still reading those two fields
> is reading a surface that no longer exists.

`Misconfigured` sets a billing `Error` and **never opens a browser**. This is deliberate: a
misconfigured product is not a licence to route a native-store digital purchase to a web payment
page. On Android that steering is the "leads users to a payment method other than Google Play's
billing system" violation that got a shipped consumer app flagged and restricted; on iOS it is an
App Store Review Guideline 3.1.1 rejection.

Its message names the remedy rather than the symptom: *set a primary provider for this platform on
the dashboard's Platform providers page, and give the product an id for it.* **So `Misconfigured` is
never an acceptable end state for `/idea-paycraft`** — it is a routing/sync gap to heal at the
dashboard, not a lane to fall back from.

## Native store lanes

### Google Play (Android)

- Billing library **9.1.0**. Client `PlayBillingNativeClient.android.kt`.
- Context + Activity captured automatically by `PayCraftInitializer` (androidx-startup), so the
  default path needs **no androidMain wiring**. `paycraftPlayBillingModule(context, activityProvider)`
  remains an opt-in override for an app that needs a custom activity provider.
- Plan change / upgrade uses `BillingFlowParams.ProductDetailsParams.SubscriptionProductReplacementParams`
  (`setOldProductId`, `setReplacementMode`), not the removed pre-v8 proration API.
- Pending purchases are enabled; `PurchaseState.PENDING` surfaces as `BillingState.PaymentPending`.
- The buyer's stable app-user-id is passed as `obfuscatedAccountId`.
- Grant path: the SDK POSTs the `purchaseToken` to the `register-play-purchase` edge function, which
  re-fetches truth from the Play Developer API. Client claims are never trusted.

### StoreKit 2 (iOS / macOS)

- **The Swift shim is now SDK-internal** — compiled to a static archive and reached via cinterop.
  `platformDefaultNativeBillingClient()` returns a real `StoreKit2NativeBillingClient()` **always**.
- There is consequently **no `paycraftStoreKit2BillingModule` and nothing to inject**. It previously
  returned null (later an `UnconfiguredStoreKitClient`) and iOS integrators had to copy
  `PayCraftStoreKit2.swift` into their Xcode target and load that module by hand. Now
  `PayCraft.initialize(apiKey)` in commonMain is the whole iOS integration, exactly as on Android —
  and "unconfigured StoreKit" is no longer a reachable state.
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

On desktop / web / js there is no native store and the module falls back to
`WebCheckoutNativeBillingClient`, a no-op that reports `Web`. That is correct there and a **defect**
on Android or iOS, where it means the real client failed to resolve.

**Offer selection.** `selectBestOffer(offers)` ranks by longest free trial, then lowest first charge,
then a stable tie-break — so a subscription with several base-plan offers presents the best one
rather than an arbitrary index. `NativePricingPhase.isFree` identifies the trial phase;
`freeTrialDays` derives from the ISO-8601 billing period.

**Storefront drives currency.** `storefrontCountry()` is the true billing region and is folded into
the `/config` request at fetch time, after the synchronous `initialize` has already picked a
provisional country from override → device region → `US`. `PayCraft.activeRegion` is the single
resolved `(country, currency)` that the displayed price **and** every provider checkout link read,
so a provider can never silently route a different currency than the one shown. When a native
display price is available it OVERRIDES the cloud price — it is what the store will actually charge
(this is what fixed an India buyer being quoted GBP instead of the store's ₹799).

## Web providers

`interface PaymentProvider { name; getCheckoutUrl(plan, email?); getManageUrl(email); webhookFunctionName }`.

Shipped adapters: Stripe, Razorpay, Paddle, PayPal, Paystack, Flutterwave, LemonSqueezy, Midtrans,
BTCPay, Custom (Cashfree is served by its own edge webhook). `ProviderCanonicalMapper` normalises
each provider's status vocabulary onto the canonical entitlement states.

The app **never** talks to a provider directly — it only reads Supabase; webhooks keep Supabase in
sync. A provider adapter exists only to produce checkout and manage URLs.

`ProviderDto` carries `testPaymentLinksBySku` and `livePaymentLinksBySku`, each a
`sku → currency → url` map; `PayCraft.mode` (derived from the `pk_` key prefix) selects which map is
read, `CurrencyResolver.checkoutCurrency` picks the currency within it, and `supportedLocales` /
`platform` scope a provider to where it is valid. A missing link for the resolved
`(sku, currency)` is an explicit error naming both — never a silent fall back to another currency.

## Store-side product sync

`SuiteConfig.products[]` is the SoT the app reads, but the *store* is where the money moves. A
product is only fully configured when all three agree:

| Layer | Field |
|---|---|
| PayCraft dashboard | `ProductDto.sku`, `type`, `interval`, `basePriceCents`/`baseCurrency`, and a routing rule naming this platform's primary provider |
| Google Play Console | a subscription/base-plan whose id equals the resolved `storeBinding.productId` |
| App Store Connect | a subscription whose id equals the resolved `storeBinding.productId` |

Failure signature per layer:

- Missing dashboard product → the plan is absent from the paywall entirely.
- No routing rule / no id for this platform → `storeBinding` is null → `CheckoutLane.Misconfigured`,
  checkout blocked.
- Id present in the dashboard but absent in the store → the store query returns no product; native
  display price is null and the purchase call fails at the store.
- Product exists but is not active/approved in the store → same shape as absent; check the store's
  own status, not just the id.

**A resolved lane and a sellable product are different claims, and the gap between them is where a
green step hid a dead app for four days.** `resolveCheckoutLane` is satisfied by a non-null
`storeBinding` — which is equally true of an App Store subscription sitting in `MISSING_METADATA`,
priced in 1 territory of 175. All three cappy subscriptions resolved a native lane on 2026-09-17
while none could be sold. So `/idea-paycraft` treats "resolves to a lane that is not `Misconfigured`,
on every platform the app ships" as necessary but **not sufficient**, and additionally asks the store
itself (`/api/products/store-readiness`) whether each product is sellable. It heals a missing id or
routing rule at its source — the dashboard row — never by relaxing the lane decision.
