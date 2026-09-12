example-provenance: 518e84790cc2794f1cd4007182d72005ae07fe56

# PUBLIC_API.md — PayCraft SDK public integration surface

> Consumed by `/idea-paycraft`. Authored by `/paycraft-dev fold` (RULE-PAYCRAFT-CORPUS-AUTHORSHIP-001
> PCA-1); never hand-edited. Every symbol below is extracted from `cmp-paycraft/src/commonMain` at the
> stamped commit — if a signature here disagrees with source, the corpus is stale and PCA-4 requires a
> re-fold before integrating.

Artifact: `io.github.mobilebytelabs:cmp-paycraft`. Targets: `jvm`, `android`, `iosArm64`,
`iosSimulatorArm64`, `js`, `wasmJs`. Everything below is `commonMain` unless noted.

## Entry point — `object PayCraft`

```kotlin
fun initialize(
    apiKey: String,                                    // "pk_test_…" | "pk_live_…" (see KEY_TIERING.md)
    backend: PayCraftBackend = PayCraftBackend.Cloud,
    options: InitOptions = InitOptions(),
    mode: MonetizationMode = MonetizationMode.AdSupported,
)
```

- **Synchronous and non-blocking.** It captures `apiKey`/`backend`, publishes a placeholder
  `PayCraftConfig` so `requireConfig()` never throws, republishes the last-known-good `SuiteConfig`
  from disk (`ConfigCache`), then launches the `/config` revalidation fire-and-forget. It never awaits
  the network.
- **Precondition (hard).** `apiKey` must start with `pk_test_` or `pk_live_`, unless `backend` is
  `PayCraftBackend.Mock`. Anything else throws `IllegalArgumentException` at the call site.
- **Idempotent-ish.** Re-invocation is supported (test re-init). It resets
  `paywallPresentation` to `Hidden` but deliberately does NOT reset the once-per-session
  auto-present debounce.
- **Call site.** `commonMain` app startup (`initKoin` / shared app init), NOT a per-platform
  Application class — see WIRING_CONTRACTS.md.

Related surface on the same object:

| Member | Shape | Notes |
|---|---|---|
| `suiteConfigFlow` | `StateFlow<SuiteConfig?>` | Null until the first config (cached or fetched) lands |
| `mode` | `Mode.{Test,Live,Unknown}` | Derived from the `pk_` key prefix, never configured separately |
| `monetizationMode` | `MonetizationMode` | Resolved: cloud `SuiteConfig.mode` wins over the `initialize` argument |
| `isAdFree` | `StateFlow<Boolean>` | Host ad-gating signal under `MonetizationMode.AdSupported` |
| `paywallPresentation` | `StateFlow<PaywallPresentation>` | `Hidden`/`Shown` — the auto-present signal |
| `billingManager` | `BillingManager?` | Koin-resolved; null before `initialize` |
| `plans` | `List<BillingPlan>` | Empty until config lands |
| `deviceId` | `String` | Lazy `DeviceFingerprint.get()`; the fallback app-user-id when no email |
| `activeRegion` / `activeCountry` / `activeCurrency` | resolved billing region | Decided once at init, refined by store storefront at fetch time |
| `suspend prefetchProducts()` | warm the cache | Call from a splash/home prefetch to avoid a first-frame skeleton |
| `refreshConfig()` | force a `/config` refetch | |
| `suspend applyCoupon(planId, code)` | `CouponClient.Result` | |
| `checkout(plan, email?)` | routes through `resolveCheckoutLane` | Never opens a browser for a native digital good |
| `manageSubscription(email)` | provider manage URL | |
| `presentPaywall()` / `presentPaywallIfNeeded(entitlement?)` | drive `paywallPresentation` | |
| `requireConfig()` | `PayCraftConfig` | Throws if `initialize` was never called |

## Backend selection — `sealed interface PayCraftBackend`

| Variant | When |
|---|---|
| `Cloud` (default) | PayCraft SaaS. Supabase URL + anon key are compiled-in constants |
| `SelfHosted(supabaseUrl, supabaseAnonKey, configPath = "/functions/v1/config")` | Enterprise, customer-operated Supabase |
| `Mock(staticConfig: SuiteConfig)` | Tests + offline previews; bypasses the `pk_` prefix precondition |

All three expose `supabaseUrl`, `supabaseAnonKey`, `configUrl`.

## Headless surface — `interface BillingManager`

Resolved from Koin (`single<BillingManager>`). This is the whole contract a bespoke paywall needs;
no PayCraft composable is required to ship billing.

**State (all hot, all `StateFlow` unless noted):**

```kotlin
val isPremium: StateFlow<Boolean>
val subscriptionStatus: StateFlow<SubscriptionStatus>
val billingState: StateFlow<BillingState>          // see BILLING_STATE_SEMANTICS.md
val userEmail: StateFlow<String?>
val isInTrial: StateFlow<Boolean>
val trialEndsAt: StateFlow<String?>                // ISO-8601 UTC or null
val subscriptionActivated: SharedFlow<SubscriptionActivated>   // replay 0, rising edge only
```

`SubscriptionActivated(sku: String?, isTrial: Boolean)` fires exactly once per non-premium → premium
transition. Replay is 0, so a late collector gets nothing — collect it from a scope that outlives the
purchase (a ViewModel started before checkout, not a dialog composed after it).

**Purchase lanes:**

```kotlin
fun purchaseViaPlayBilling(plan: BillingPlan, email: String?)   // Android digital
fun purchaseViaStoreKit(plan: BillingPlan, email: String?)      // iOS/macOS digital
```

Both drive `billingState`: `Loading` → `Premium` | `Free` (user cancelled) | `PaymentPending` |
`Error`. A missing `playProductId` / `appStoreProductId` is an **`Error`, never a web fallback** —
that anti-steering rule is the point of `CheckoutLane.Misconfigured` (PROVIDERS_AND_STORES.md).

StoreKit has no client-facing grant endpoint: entitlement truth lands server-side via the Apple
App Store Server Notifications webhook, so success reconciles through the normal refresh path.

**Identity + entitlement:**

```kotlin
fun registerAndLogin(email: String)                 // replaces logIn(); logIn() delegates here
fun logIn(email: String)                            // legacy alias
fun refreshStatus(force: Boolean = false)           // honours SyncPolicy unless force
suspend fun checkTrialEligibility(): Boolean        // optimistic true on any failure
suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String)   // Gate 1
fun logOut()
```

**Device-conflict resolution (Gate 1 → Gate 2 → Gate 3):**

```kotlin
suspend fun verifyOtpOwnership(email: String, otp: String): Boolean   // Gate 2
suspend fun confirmDeviceTransfer()                                    // after OwnershipVerified
suspend fun revokeCurrentDevice()
suspend fun transferToDevice()                                         // internal
suspend fun requestOtpVerification(email: String)                      // deprecated
suspend fun verifyOtp(email: String, otp: String): Boolean             // internal
```

The UI **must** show an explicit confirmation between `OwnershipVerified` and
`confirmDeviceTransfer()` — the user is deactivating another device.

## Cloud-config surface — `SuiteConfig`

Fetched from `{backend}/functions/v1/config`, cached to disk, exposed via `PayCraft.suiteConfigFlow`.

```kotlin
data class SuiteConfig(
    tenantId: String, plan: String?,
    products: List<ProductDto>, providers: List<ProviderDto>,
    paywall: PaywallDto, locale: String = "US",
    mode: MonetizationMode?, geoCountry: String?, geoSource: String?,
    cacheTtlSeconds: Int = 3600, fetchedAtEpochMillis: Long = 0L,
)
```

`ProductDto` carries `sku`, `type` (`subscription|trial|lifetime`), `interval`,
`basePriceCents`/`baseCurrency`, `resolvedPrice`, `trialEnabled`/`trialDurationDays`,
`displayOrder`, `active`, and the two store ids `playProductId` / `appStoreProductId` — the fields
the checkout-lane decision reads.

`PaywallDto` carries `template` (default `branded-stack`), `themeJsonb`, `branding`,
`primaryColor`, `fontFamily`, `heroTitle`/`heroSubtitle`, `valueProps`, the CTA + restore labels,
`termsUrl`/`privacyUrl`, `popularPlanSku`, and the success-sheet copy. See PAYWALL_CUSTOMIZATION.md.

## Compose surface (optional)

`PayCraftPaywall`, `PayCraftPaywallSheet`, `PayCraftSheet`, `PayCraftBanner`,
`PayCraftInlinePaywallBanner`, `PayCraftPremiumBanner`, `PayCraftPremiumGuard`,
`PayCraftPremiumGuardInline`, `PayCraftRestore`, `PayCraftRestoreContent`,
`PayCraftCheckoutSuccessSheet`, `PayCraftCheckoutSuccessSheetOrPaywall`, `BannerPaywall`,
`PayCraftPaywallComposable`. Surface-mode contract in PAYWALL_CUSTOMIZATION.md.

## What an integrator must never do

- Call a payment provider directly. The app talks only to Supabase; webhooks keep Supabase in sync.
- Ship an `sk_` key in client source (KEY_TIERING.md).
- Open a web checkout for a digital good on Android or iOS (PROVIDERS_AND_STORES.md).
- Treat `BillingState.PaymentPending` as a failure (BILLING_STATE_SEMANTICS.md).
