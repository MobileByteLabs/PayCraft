example-provenance: 9cb5162c248fb9426d460f2328ffda6882c29462

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

- **Synchronous and non-blocking.** It captures `apiKey`/`backend`, resolves the billing country
  once (override → device region → `US`), resets `paywallPresentation` to `Hidden`, republishes the
  last-known-good `SuiteConfig` from disk (`ConfigCache`), then launches the `/config` revalidation
  fire-and-forget. It never awaits the network.
- **Precondition (hard).** `apiKey` must start with `pk_test_` or `pk_live_`, unless `backend` is
  `PayCraftBackend.Mock`. Anything else throws `IllegalArgumentException` at the call site.
- **Idempotent-ish.** Re-invocation is supported (test re-init). It resets `paywallPresentation` to
  `Hidden` but deliberately does NOT reset the once-per-session auto-present debounce — the debounce
  clears on process death, the natural session boundary.
- **Call site.** `commonMain` app startup (`initKoin` / shared app init), NOT a per-platform
  Application class — see WIRING_CONTRACTS.md.

Related surface on the same object:

| Member | Shape | Notes |
|---|---|---|
| `suiteConfigFlow` | `StateFlow<SuiteConfig?>` | Null until the first config (cached or fetched) lands |
| `configResultFlow` | `StateFlow<ConfigResult>` | **WHICH resilience layer answered** — see below |
| `isConfigured` | `Boolean` | True when a `pk_test_`/`pk_live_` key was supplied. The SDK owns this question |
| `mode` | `Mode.{Test,Live,Unknown}` | Derived from the `pk_` key prefix, never configured separately |
| `monetizationMode` | `MonetizationMode` | Resolved: cloud `SuiteConfig.mode` wins over the `initialize` argument |
| `isAdFree` | `StateFlow<Boolean>` | Host ad-gating signal under `MonetizationMode.AdSupported` |
| `paywallPresentation` | `StateFlow<PaywallPresentation>` | `Hidden`/`Shown(trigger)` — the auto-present signal |
| `billingManager` | `BillingManager?` | Koin-resolved; null before `initialize` |
| `plans` | `List<BillingPlan>` | Empty until config lands |
| `deviceId` | `String` | Lazy `DeviceFingerprint.get()`; the fallback app-user-id when no email |
| `activeRegion` | `ResolvedRegion(country, currency)` | THE single resolved billing region |
| `activeCountry` / `activeCurrency` | `String` | Flat projections of `activeRegion` |
| `suspend prefetchProducts()` | warm the cache | Call from a splash/home prefetch to avoid a first-frame skeleton |
| `refreshConfig()` | force a `/config` refetch | |
| `suspend applyCoupon(planId, code)` | `CouponClient.Result` | |
| `setAppliedCoupon(planId, coupon?)` | attach/clear a validated coupon | Appended to the checkout URL |
| `checkout(plan, email?)` | routes through `resolveCheckoutLane` | Never opens a browser for a native digital good |
| `manageSubscription(email)` | provider manage URL | |
| `presentPaywall()` / `presentPaywallIfNeeded(entitlement?)` / `dismissPaywall()` | drive `paywallPresentation` | |
| `onAppOpen(entitlement, trial)` | app-open dispatch | Mode-driven; see below |
| `requireConfig()` | `PayCraftConfig` | Throws if `initialize` was never called |

### `configResultFlow` — the distinction `suiteConfigFlow` cannot express

`suiteConfigFlow` still exists and still emits; every existing consumer keeps working. What it
cannot say is whether a null means "no config yet", "the fetch failed", or "this is last week's
cache" — all three look identical there, which is how an offline user sat on a spinner forever.

```kotlin
sealed interface ConfigResult {
    data object Loading
    data class  Fresh(config)                    // network answered
    data class  Cached(config)                   // disk, within TTL
    data class  Stale(config, ageSeconds)        // disk, past TTL — usable, show the age
    data class  Bundled(config)                  // shipped-in fallback asset
    data object BuiltIn                          // SDK's own last-resort defaults
    data class  Failed(reason, detail?)          // reason ∈ OFFLINE|HTTP_ERROR|DECODE_ERROR|NOT_INITIALIZED|UNKNOWN
}
```

Helpers: `configOrNull`, `isLoading`, `isStale`, `isRetryable`. `isRetryable` is deliberately false
for `DECODE_ERROR` (malformed, not flaky) and `NOT_INITIALIZED` (a retry cannot start a billing
stack) — offering "Try again" there trains the buyer that retry does nothing.

### `onAppOpen(entitlement: EntitlementSnapshot, trial: TrialSnapshot)`

The combined "resync entitlement + maybe present" signal, called from the host's
onResume/onCreate hook. It always updates `AdFreeEntitlement` first, then dispatches by mode:

- `TrialManaged` — auto-presents ONCE per process when the buyer is **not** premium **and** has an
  active or just-ended trial (`trial.isActiveOrNearExpiry`) **and** the session debounce is unmarked.
- `AdSupported` — never auto-presents; the host owns the trigger and reads `isAdFree` to gate ads.

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
`Error`. A plan with **no `storeBinding`** is an **`Error`, never a web fallback** — that
anti-steering rule is the point of `CheckoutLane.Misconfigured` (PROVIDERS_AND_STORES.md).

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

**Device-conflict resolution (Gate 1 → Gate 2):**

```kotlin
suspend fun confirmDeviceTransfer()                 // after OwnershipVerified
suspend fun revokeCurrentDevice()
suspend fun transferToDevice()                      // internal
```

The UI **must** show an explicit confirmation between `OwnershipVerified` and
`confirmDeviceTransfer()` — the user is deactivating another device.

> **The OTP arm is gone.** `requestOtpVerification` / `verifyOtp` / `verifyOtpOwnership` were removed
> on 2026-09-06 along with the `otp-send-hook` edge function, and `VerificationMethod` now has a
> single entry, `OAUTH`. A call site still referencing them will not compile. The trade-off is
> deliberate and worth stating: OTP was the only self-service route for a custom-domain email that
> cannot be linked to a Google or Apple account, so those buyers now go straight to Gate 2 (manual
> support) instead of resolving a device conflict themselves.

## Cloud-config surface — `SuiteConfig`

Fetched from `{backend}/functions/v1/config`, cached to disk, exposed via `PayCraft.suiteConfigFlow`.

```kotlin
data class SuiteConfig(
    tenantId: String, plan: String?,
    products: List<ProductDto>, providers: List<ProviderDto>,
    paywall: PaywallDto,
    offerings: List<OfferingDto> = emptyList(),
    locale: String = "US",
    mode: MonetizationMode?, geoCountry: String?, geoSource: String?,
    cacheTtlSeconds: Int = 300, fetchedAtEpochMillis: Long = 0L,
)
```

`ProductDto` carries `id`, `sku`, `type` (`subscription|trial|lifetime`), `displayName`, `interval`,
`basePriceCents`/`baseCurrency`, `resolvedPrice`, `trialEnabled`/`trialDurationDays`,
`attachesToProductId`, `discountPercent`/`discountEndsAt`, `displayOrder`, `active`, and
**`storeBinding`**.

> **`storeBinding` replaced the `playProductId` / `appStoreProductId` pair.** It is
> `StoreBinding(provider, productId)` — one binding, **resolved server-side** from
> `tenant_routing_rules` for the platform in the `x-paycraft-platform` request header. The client no
> longer picks the store. Shipping every store's id and letting the client choose by platform made
> the dashboard's Platform-providers page decorative: an app whose iOS primary was set to Stripe
> still went to StoreKit, because the choice was hardcoded in `resolveCheckoutLane`. Null when the
> platform has no usable provider.

`OfferingDto` → `PackageDto` maps a package **role** (`$rc_annual`) to a purchasable SKU. A paywall
component tree binds a plan card to a role, never a SKU, so a tree survives store migrations and
per-platform product ids; this is the only mapping from that role to something purchasable.

`PaywallDto` carries the v1 columns (`template`, `themeJsonb`, `branding`, `primaryColor`,
`fontFamily`, `customFooter`), the v2 content fields (hero copy, `valueProps`, CTA + restore labels,
`termsUrl`/`privacyUrl`, `popularPlanSku`, success-sheet copy, trial-disclosure copy, `heroIconSvg`,
`supportEmail`), and the epic-2 component tree: **`workflow: JsonElement?`** + `schemaVersion`. See
PAYWALL_CUSTOMIZATION.md.

## Compose surface (optional)

`PayCraftPaywall`, `PayCraftPaywallSheet`, `PayCraftSheet`, `PayCraftBanner`,
`PayCraftInlinePaywallBanner`, `PayCraftPremiumBanner`, `PayCraftPremiumGuard`,
`PayCraftPremiumGuardInline`, `PayCraftRestore`, `PayCraftRestoreContent`,
`PayCraftPaywallWithRestore`, `PayCraftCheckoutSuccessSheet`,
`PayCraftCheckoutSuccessSheetOrPaywall`, `BannerPaywall`, `PayCraftPaywallComposable`,
`ProductList`. Surface-mode contract in PAYWALL_CUSTOMIZATION.md.

`PayCraftTestTags` publishes the stable tags every one of those surfaces sets
(`paycraft_paywall_screen`, `paycraft_plan_card_<planId>`, `paycraft_payment_pending`,
`paycraft_subscribe_button`, …) — assert against these rather than against visible text, which is
tenant-configurable and localized.

## What an integrator must never do

- Call a payment provider directly. The app talks only to Supabase; webhooks keep Supabase in sync.
- Ship an `sk_` key in client source (KEY_TIERING.md).
- Open a web checkout for a digital good on Android or iOS (PROVIDERS_AND_STORES.md).
- Treat `BillingState.PaymentPending` as a failure (BILLING_STATE_SEMANTICS.md).

---

## Removing something from this surface

**Default: change it and fix the call sites in the same change.** Every consumer of this SDK is ours
— `reels-downloader`, `steady`, `cappy` — and they are updated directly. When you own every call
site, a deprecation window warns nobody: it is ceremony paid on each change and never collected.

**Deprecate only when a release could reach code we cannot edit.** The artifact is published to
Maven Central as `io.github.mobilebytelabs:cmp-paycraft`, so this becomes true the day PayCraft has
an adopter outside the workspace. Until then it is not true, and pretending otherwise adds process
without adding safety.

**When that day comes, or when something is already deprecated, these hold:**

- State the version that removes it. "Superseded by X" with no date either lives forever or vanishes
  without notice. `PaywallTemplate` gets this right — *"will be removed in cmp-paycraft 3.0.0"*.
- Add `replaceWith` only when the migration is a mechanical substitution. `MINIMAL → BRANDED_STACK`
  is one identifier for another, so the IDE should apply it. `ConfigClient → collect
  PayCraft.configResultFlow` is not, and a quick-fix that rewrites to something wrong is worse than
  none, because it is applied without being read.
- `DeprecationLevel.WARNING` means the call still works. If it cannot, the honest states are ERROR
  or removal.

`infra/verify/verify-deprecation-policy.sh` enforces the first of these — the other two need
judgement a grep cannot supply.

### Two cases this was written from, stated accurately

**`PayCraft.configure {}`** was introduced in v1.0.0 and deleted in v2.0 in one release, with no
version in between carrying `@Deprecated`. That task was **superseded, not skipped**: the consumer
was migrated directly instead, and no integrator was ever left holding a broken build — which is the
only harm a deprecation window exists to prevent.

**The OTP methods** were removed the same way, and the honest note is that this one had a cost the
first did not: it removed a capability rather than renaming one. That belongs in the record
(BILLING_STATE_SEMANTICS.md states who it affects), not hidden behind a clean signature diff.
