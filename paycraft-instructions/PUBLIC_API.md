example-provenance: d17c43b42c05b30b9029e3cbcbbfa314a8bd372b

# PUBLIC_API.md — PayCraft SDK public integration surface

> Consumed by `/idea-paycraft`. Authored by `/paycraft-corpus-fold` (RULE-PAYCRAFT-CORPUS-AUTHORSHIP-001
> PCA-1); never hand-edited. Every symbol below is extracted from `cmp-paycraft/src/commonMain` at the
> stamped commit — if a signature here disagrees with source, the corpus is stale and PCA-4 requires a
> re-fold before integrating.

Artifact: `io.github.mobilebytelabs:cmp-paycraft`. Targets: `jvm`, `android`, `iosArm64`,
`iosSimulatorArm64`, `js`, `wasmJs`. Everything below is `commonMain` unless noted.

## Entry point — `object PayCraft`

```kotlin
fun initialize(
    apiKey: String,                                    // LIVE publishable key (see KEY_TIERING.md)
    backend: PayCraftBackend = PayCraftBackend.Cloud,
    options: InitOptions = InitOptions(),
    mode: MonetizationMode = MonetizationMode.AdSupported,
    testApiKey: String? = null,                        // used INSTEAD of apiKey on a Debug build
)
```

- **Synchronous and non-blocking.** It captures `apiKey`/`backend`, resolves the billing country
  once (override → device region → `US`), resets `paywallPresentation` to `Hidden`, republishes the
  last-known-good `SuiteConfig` from disk (`ConfigCache`), then launches the `/config` revalidation
  fire-and-forget. It never awaits the network.
- **Precondition (hard).** `apiKey` must be PUBLISHABLE — `startsWith("pk_")` — unless `backend` is
  `PayCraftBackend.Mock`. An `sk_…` secret key throws `IllegalArgumentException` at the call site.
  Mode is NOT in the prefix. `PayCraft.mode` AND the key choice both resolve from
  `PlatformInfo.buildKind`, read from the artifact itself (APK signing certificate / embedded
  provisioning profile / packaging / origin) — see KEY_TIERING.md. A
  `pk_YOUR…` placeholder passes this guard and surfaces as `isConfigured == false` (Free), rather
  than throwing. See KEY_TIERING.md for the provisioning caveat.
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

## The three injectable facades — one per consumer layer

**Everything a consumer needs is injected from Koin (`payCraftModule`); a consumer writes no
repository, store, or API wrapper of its own.** The three surfaces line up with the layers a KMP
consumer already has, so billing does not need a home invented for it:

| facade | consumer layer | answers |
|---|---|---|
| `PayCraftApi` | `core/network` | how is this app configured, where is the buyer, refresh from the server |
| `PayCraftRepository` | `core/data` | what does THIS USER have, let them transact, drive the paywall |
| `PayCraftStore` | `core/store` | what is cached on this device |

Three singleton members are deliberately on NO facade — `initialize`, `requireConfig`, `deviceId`
— plus the raw `configResultFlow` / `suiteConfigFlow` transport. They are bootstrap: a feature
module that can re-initialize the SDK can repoint it at another tenant mid-session.

**`PayCraft.billingManager` is `internal`.** It was public, and the only thing consumers used it for
was a one-line identity bind — `PayCraft.billingManager?.logIn(email)`, the single usage across
every consumer. To get that, a host was handed the whole engine: purchase launching, device
transfer, OAuth, revocation. Nothing stopped a feature module calling `purchaseViaPlayBilling`
directly and bypassing lane resolution. The identity capability is on `PayCraftRepository` instead;
the device-transfer trio stays internal because the SDK's own device-conflict UI is the only correct
caller.

`G-PAYCRAFT-FACADE-COVERAGE` asserts the split, because it had already drifted once —
`manageSubscriptionUrl` was added to the singleton and to no facade, and the first consumer wrote a
delegate file to reach it.

### `core/data` — `interface PayCraftRepository`

```kotlin
interface PayCraftRepository {
    val isPremium: StateFlow<Boolean>                    // THE gating signal
    val billingState: StateFlow<BillingState>            // where a purchase IS
    val subscriptionStatus: StateFlow<SubscriptionStatus>
    val isInTrial: StateFlow<Boolean>
    val entitlement: StateFlow<EntitlementSummary>       // tier + role + trial end — prefer for GATING
    val plans: StateFlow<List<BillingPlan>>
    fun checkout(plan: BillingPlan, email: String? = null)   // fire-and-observe, no synchronous verdict
    suspend fun restore(): Entitlement                       // genuinely has an answer, so it suspends
    fun manageSubscription(email: String? = null)             // email OPTIONAL: a store-billed
    fun manageSubscriptionUrl(email: String? = null): String? //   subscriber has no email we know
    fun refresh(force: Boolean = false)

    val isAdFree: StateFlow<Boolean>                     // SEPARATE from isPremium (AC-12)
    suspend fun applyCoupon(planId: String, code: String): CouponClient.Result
    fun setAppliedCoupon(planId: String, coupon: CouponDto?)

    val paywallPresentation: StateFlow<PaywallPresentation>
    fun presentPaywall()
    fun presentPaywallIfNeeded(entitlement: String? = null)   // no-op when already entitled
    fun dismissPaywall()
    fun onAppOpen(entitlement: EntitlementSnapshot, trial: TrialSnapshot)

    val userEmail: StateFlow<String?>                    // identity — an entitlement has an owner
    fun logIn(email: String)                             // call on EVERY identity change
    fun logOut()                                         // drops the entitlement with the identity
    suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String)
    suspend fun checkTrialEligibility(): Boolean         // ask BEFORE advertising a trial
    val subscriptionActivated: SharedFlow<SubscriptionActivated>  // JUST became premium
}
```

- **Why it exists.** Every consumer was hand-writing it. Measured on `mbs/cappy`: 670 LOC across five
  modules, of which `PayCraftApiImpl` alone was 233 lines holding 12 SDK call sites — roughly 95%
  type translation, not logic. A facade over `BillingManager` + `EntitlementRepository` + the config
  flows; it introduces no new concept and owns no state.
- **`checkout` returns `Unit` deliberately.** There is no synchronous verdict to return, so a
  `Result<Unit>` would be a lie — observe `billingState` for the outcome.
- **`plans` is a flow** where `PayCraft.plans` is a plain `List`, because a paywall opened before the
  first `/config` lands would otherwise render empty forever with no way to recover.
- **Still internal, deliberately:** `EntitlementRepository` (Store5) and `PayCraftService`
  (networking). Both thread an `appUserId` and speak `StoreReadResponse<Entitlement>` — the plumbing
  this facade exists to hide.

### `EntitlementSummary` — the gating value

```kotlin
enum class EntitlementTier { FREE, TRIAL, PREMIUM }

data class EntitlementSummary(
    val tier: EntitlementTier = EntitlementTier.FREE,
    val roleIdentifier: String? = null,   // package role — for an app with several paid tiers
    val planSku: String? = null,
    val entitlementId: String? = null,
    val trialEndsAt: String? = null,
    val willRenew: Boolean = true,
) {
    val isPremium: Boolean   // TRIAL counts as premium — trialing users have access
    val isInTrial: Boolean
}
```

Prefer this over `billingState` for GATING. `BillingState` describes where a purchase IS (Loading /
PaymentPending / Error / DeviceConflict), which is right for a checkout flow and wrong for "can this
user open the premium pack?". `EntitlementSummary.from(state, …, previous)` folds the process states
so they PRESERVE the previous tier — a payment settling must never show the paywall to someone who
already paid.

`roleIdentifier` carries the package role (`BillingPlan.roleIdentifier`, resolved by
`SuiteConfig.roleForSku(sku)`), so an app derives its own tier notion from tenant configuration
instead of hardcoding product names.

### `core/network` — `interface PayCraftApi`

```kotlin
interface PayCraftApi {
    val isConfigured: Boolean          // false = unprovisioned; runs local-first, gates read free
    val mode: PayCraft.Mode            // test|live, derived from the ARTIFACT — never branch billing on it
    val monetizationMode: MonetizationMode
    val activeRegion: ResolvedRegion   // DISPLAY only — never compute a price from it
    val activeCountry: String
    val activeCurrency: String
    fun refreshConfig()
    suspend fun prefetchProducts()     // warm the store cache before a paywall opens
}
```

`activeCurrency` is for showing "prices in ₹", never for deriving an amount: the authoritative price
is on the plan, already resolved per-country server-side. Computing one locally from a currency code
is how a ¥400 plan became ¥32,900.

### `core/store` — `interface PayCraftStore`

```kotlin
interface PayCraftStore {
    suspend fun saveEmail(email: String); suspend fun getEmail(): String?; suspend fun clearEmail()

    fun cacheSubscriptionStatus(status: SubscriptionStatus) {}   // non-suspend: read during
    fun getCachedSubscriptionStatus(): SubscriptionStatus? = null //   construction, before frame 1
    fun getLastSyncedAt(): Long = 0L
    fun clearCache() {}

    fun getAdUnlockExpiry(featureKey: String): Long? = null       // ABSOLUTE expiry, per feature
    fun saveAdUnlock(featureKey: String, expiresAtEpochMillis: Long) {}
    fun clearAdUnlock(featureKey: String) {}
    fun getAllAdUnlocks(): Map<String, Long> = emptyMap()

    fun getDeviceToken(): String? = null                          // identity when there is no email
    fun saveDeviceToken(token: String) {}
    fun clearDeviceToken() {}

    suspend fun clearAll()                                        // the sign-out call
}
```

**Read it; think hard before writing it.** Most apps never call this — the SDK writes it, and
`PayCraftRepository`'s flows are offline-tolerant precisely BECAUSE this cache exists. Writing it
directly asserts an entitlement the server has not confirmed. The one write a host legitimately owns
is `clearAll()` on sign-out; a sign-out that leaves a cached entitlement shows the next user the
previous user's premium state.

**Every added member carries a default** because this is HOST-IMPLEMENTABLE: an app may supply its
own storage, and an abstract member would break it on upgrade. The shipped `PayCraftSettingsStore`
implements all of them for real — a default that no implementation overrides is a declared
capability that silently does nothing.

Ad-unlock expiry is stored ABSOLUTE, not as a remaining duration: a duration silently extends itself
on every process restart, so one watched ad would unlock the feature forever. An expired grant reads
as absent and is evicted on read, so the key set cannot grow unbounded.

### `FakePayCraftRepository` — ships in the MAIN artifact

Not a test fixture, on purpose. Removing the app-owned wrapper is only honest if testability moves
with it, and a fake behind `testImplementation` would not reach a consumer's `commonTest` without
extra wiring. `FakePayCraftRepository(premium = true)` plus `setPremium` / `setEntitlement` /
`setPlans` mutators; `checkoutCalls` / `manageSubscriptionCalls` / `refreshCalls` record instead of
performing, so a test can assert a tap reached the SDK without opening anything.

## Backend selection — `sealed interface PayCraftBackend`

| Variant | When |
|---|---|
| `Cloud` (default) | PayCraft SaaS. Supabase URL + anon key are compiled-in constants |
| `SelfHosted(supabaseUrl, supabaseAnonKey, configPath = "/functions/v1/config")` | Enterprise, customer-operated Supabase |
| `Mock(staticConfig: SuiteConfig)` | Tests + offline previews; bypasses the `pk_` prefix precondition |

All three expose `supabaseUrl`, `supabaseAnonKey`, `configUrl`.

## Headless surface — `interface PayCraftRepository`

Resolved from Koin (`single<PayCraftRepository>`). This is the whole contract a bespoke paywall
needs; no PayCraft composable is required to ship billing.

> **This section used to document `interface BillingManager`.** That type is now `internal`: it was
> public, appeared as a parameter on six composables, and nothing a consumer legitimately needs was
> reachable only through it. `PayCraftRepository` is the facade over it, and the last gap — the
> device-conflict actions below — was closed when it went internal, because a facade exposing a
> state (`OwnershipVerified`) without the actions that resolve it is not a facade.
>
> Three facades, one per layer, all `single<…>` in `PayCraftModule`:
> `PayCraftApi` (network · `core/network`), `PayCraftRepository` (data · `core/data`),
> `PayCraftStore` (persistence · `core/store`). Inject the one your layer needs.

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

**Checkout:**

```kotlin
fun checkout(plan: BillingPlan, email: String? = null)
```

ONE entry point. It resolves the lane itself — Play Billing on Android, StoreKit on iOS/macOS, the
provider's web checkout elsewhere — from the plan's server-resolved `storeBinding`. The per-lane
methods (`purchaseViaPlayBilling` / `purchaseViaStoreKit`) are internal to `BillingManager`
precisely so a host cannot pick a lane the dashboard's platform-provider setting did not choose;
picking client-side is what made that setting decorative before `storeBinding` existed.

It drives `billingState`: `Loading` → `Premium` | `Free` (user cancelled) | `PaymentPending` |
`Error`. A plan with **no `storeBinding`** is an **`Error`, never a web fallback** — that
anti-steering rule is the point of `CheckoutLane.Misconfigured` (PROVIDERS_AND_STORES.md).

StoreKit has no client-facing grant endpoint: entitlement truth lands server-side via the Apple
App Store Server Notifications webhook, so success reconciles through the normal refresh path.

**Identity + entitlement:**

```kotlin
fun logIn(email: String)                            // registers this device, then checks status
fun logOut()
fun refresh(force: Boolean = false)                 // honours SyncPolicy unless force
suspend fun checkTrialEligibility(): Boolean        // optimistic true on any failure
suspend fun loginWithOAuth(provider: OAuthProvider, idToken: String)   // Gate 1
```

`logIn` is the facade's name for register-device-then-check. `BillingManager` spells the same thing
`registerAndLogin` and keeps `logIn` as a legacy alias; the facade exposes one name, not both.

For `loginWithOAuth`, the HOST runs the platform sign-in and passes the resulting ID token. Supply
the handler once with `ProvidePayCraftOAuthHandler` and every SDK surface that needs it — the
restore sheet, the device-conflict screen — gains its sign-in buttons.

**Device-conflict resolution (Gate 1 → Gate 2):**

```kotlin
suspend fun confirmDeviceTransfer()                 // after OwnershipVerified — moves it HERE
suspend fun revokeCurrentDevice()                   // release this device's slot instead
```

`transferToDevice()` is NOT on the facade. `BillingManager` documents it as "internal — called by
`confirmDeviceTransfer`", and exposing it would hand a host the half-step that skips deactivating
the other device.

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

`interval` is `week | month | quarter | semiannual | year`, or absent for a non-recurring product.
It parses to `Product.Subscription.Interval`, whose `when`s are exhaustive with **no `else` arm** —
deliberately, so adding a cadence makes the compiler name every display site instead of a new value
rendering as whatever the fallback said. `parseInterval` likewise `error()`s on an unrecognised
string rather than defaulting: a silent fallback to `MONTH` would bill a weekly subscriber monthly.

The DEFAULT CATALOGUE every consumer is seeded with is `week · month · quarter · year`, each with a
14-day trial. `semiannual` is not seeded any more but remains fully valid — tenants still sell it,
so the value was never revoked. Per-country prices are NOT in the DTO's base fields: `resolvedPrice`
carries the band-resolved amount for the caller's country (32 countries, USD-relative multipliers,
charm rounding), which is why a client must never convert `basePriceCents` itself.

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

`PayCraftPaywall`, `PayCraftPaywallSheet`, `PayCraftSheet`, `PayCraftPlanBanner`,
`PayCraftInlinePaywallBanner`, `PayCraftPlanSection`, `PayCraftPaywallWithRestore`,
`PayCraftCheckoutSuccessSheet`, `PayCraftCheckoutSuccessSheetOrPaywall`, `BannerPaywall`,
`PayCraftPaywallComposable`, `ProductList`, plus the gates (`PayCraftGate`,
`PayCraftTeaseGate`, `PayCraftAdGate`) and the style/theme types
(`PayCraftPlanBannerStyle`, `PayCraftPlanSectionStyle`, `PayCraftPlanSectionTheme`).
Surface-mode contract in PAYWALL_CUSTOMIZATION.md.

Deliberately NOT public: `PayCraftRestore` / `PayCraftRestoreContent` (the SDK presents restore
itself, from the banner's link or the settings row), `PayCraftPremiumBanner` (now
`PayCraftPlanBannerStyle.Upsell`), `BillingManager` and `PayCraftPaywallViewModel`. Consumers reach
data and actions through `PayCraftRepository` / `PayCraftStore` / `PayCraftApi`.

### Gates — how a consumer locks a surface

Three composables, and the choice is about what the lock does to the CONTENT. A consumer does not
author the chip, the lock state or the upsell surface: the SDK renders all three from live
entitlement, so they cannot drift from the entitlement or from the offer.

| Gate | Behaviour | Use when |
|---|---|---|
| `PayCraftGate` | REPLACES the gated content with the SDK's offer (`DisplayMode.FullScreen` / `.Banner`) | the gated thing is a TRANSACTION or a whole screen |
| `PayCraftTeaseGate` | content stays visible and readable; only the TAP is shielded, and the upsell sheet is raised in place over it | the user should still SEE what the subscription unlocks |
| `PayCraftAdGate` | time-boxed unlock per feature key, via a consumer-supplied `ads` slot | the app monetises with ads as well as subscriptions |

`PayCraftTeaseGate` takes `enabled` for a list MIXING free and locked rows: pass the row's own
catalogue flag, and the gate still decides whether to LOCK from live entitlement, so a subscriber
gets the row ungated with no chip. `badge` and `lockedContentDescription` have usable defaults.

**Do NOT keep a consumer-side entitlement flag beside a gate.** Measured 3/5 on `mbs/cappy`
2026-10-10: each such flag was never supplied by DI (defaulted `false`, or derived with no
entitlement input at all), so every one locked PAYING SUBSCRIBERS out of content they had bought.
The gates read live entitlement; that is the point of using them.

**Testability.** The gates' chip and shield carry stable tags (`paycraft_gate_plus_chip`,
`paycraft_gate_soft_shield`, `paycraft_gate_locked`, `paycraft_gate_unlocked`). The wrapped
content's OWN tags do NOT survive on device: the shield is a full-bleed clickable with bounds
identical to the gate, and uiautomator prunes everything beneath it — so retarget device flows to
the gate's tags. The inner tags stay valid for Compose `commonTest`, which does not prune
occlusions. `LocalPayCraftEntitlementOverride` drives Entitled/NotEntitled/Resolving in unit tests
without a Koin graph.

**Deprecated predecessors:** `PayCraftPremiumGuard`, `PayCraftPremiumGuardInline` and
`PayCraftPaywallGuardScreen` are `@Deprecated` and still exported for one release. New consumers
wire a gate; existing ones migrate. Do not wire a new integration to a guard.

`PayCraftTestTags` publishes the stable tags every one of those surfaces sets
(`paycraft_paywall_screen`, `paycraft_plan_card_<planId>`, `paycraft_payment_pending`,
`paycraft_subscribe_button`, …) — assert against these rather than against visible text, which is
tenant-configurable and localized.

## Consumables — one-time packs that grant units

A CONSUMABLE is a product bought repeatedly that grants a quantity into a balance the host spends
(a coin pack, a credit bundle). It is the second shape of product beside the recurring plan, and it
is wired differently end to end: a subscription grants ACCESS which the SDK answers with
`isPremium`, while a consumable grants UNITS which only the host can store, because only the host
knows what they mean.

### The catalogue splits in two

```kotlin
PayCraft.plans               // the WHOLE catalogue
PayCraft.products            // isConsumable || interval == "lifetime"  — the STORE half
PayCraft.subscriptionPlans   // !isConsumable                           — the PAYWALL half
```

`plans` is the full list; the two subsets partition it by what the surface is allowed to sell. Use
`subscriptionPlans` for anything that picks a plan by rank — a paywall taking `minByOrNull { rank }`
over the unfiltered list can offer a coin pack as the "upgrade" a free user is shown.

On `BillingPlan`: `isConsumable: Boolean` and `grantQuantity: Int` (units ONE purchase grants; `0`
for every other type). `isConsumable` is carried explicitly rather than derived, because `interval`
collapses a null to `"lifetime"` — which makes a consumable indistinguishable from a lifetime
unlock, and the two are FINISHED with different store calls.

### Where purchased units go — `ConsumableGrantSink`

The host states one thing: how to credit its own ledger. Everything else is the SDK's.

```kotlin
public fun interface ConsumableGrantSink {
    public suspend fun credit(sku: String, quantity: Int, grantId: String): Boolean
}
```

Bound ONCE, beside `identity`, as a `Scope.() -> ConsumableGrantSink` so the lambda can `get()` the
host's own database:

```kotlin
includes(
    payCraft(
        apiKey = …, testApiKey = …,
        identity = { get<AuthRepository>().session.map { it.user?.email } },
        onUnitsGranted = {
            val dao = get<AppDatabase>().ledgerDao
            ConsumableGrantSink { sku, quantity, grantId ->
                dao.insert(LedgerEntry(id = grantId, amount = quantity, /* … */))
                true
            }
        },
    ),
)
```

Contract, and each clause is load-bearing:

- **`grantId` is a STABLE id for this grant.** Credit idempotently on it — use it as the PRIMARY KEY
  of the host's ledger row and insert with `IGNORE`-on-conflict. The sink can be invoked again for
  the same grant after a crash or a provider redelivery.
- **Return `true` only when the credit is DURABLY committed.** Returning `false` (or throwing) keeps
  the grant pending and the next drain retries it. The SDK will not drop it.
- **The host never chooses the amount.** It transfers what the server granted. A client that could
  decide the quantity is minting currency people pay real money for.
- **Omit `onUnitsGranted` and nothing drains.** An app with no consumables pays nothing for this.

### What the SDK does on its own

Given the sink, the SDK owns: which products are consumable, noticing a server-side balance,
debiting it with a caller-owned idempotency key, and replaying after a crash. It drains at init and
is cheap when there is nothing outstanding (one balance read per consumable sku).

The transfer is two writes against systems that cannot share a transaction, so the intent is
persisted BEFORE the server is touched — credit-then-debit double-credits on retry, debit-then-credit
loses the purchase. Every step is then safe to repeat.

Do NOT re-implement this in the host. The first consumer wrote 118 lines to do it and every one of
them was an invariant of the SDK.

### Headless surface (`PayCraftRepository`)

```kotlin
val balances: StateFlow<Map<String, Int>>
suspend fun refreshBalance(sku: String): Int
suspend fun spend(sku: String, quantity: Int, idempotencyKey: String): Result<Int>
```

`spend` returns the server's new balance. Insufficient funds is `Result.failure`, NOT an exception —
a shopper short on units is an ordinary outcome the host renders, not a crash. A rejected spend must
not move the balance. Pass a caller-owned `idempotencyKey` so a retry after a timeout replays
instead of charging twice.

Hosts that render their own currency read `balances` (or `PayCraftBalance`); `PayCraftStoreSection`
deliberately shows no per-row balance, because a pack's balance is the balance of the currency it
grants, not of the pack sku.

## What an integrator must never do

- Call a payment provider directly. The app talks only to Supabase; webhooks keep Supabase in sync.
- Ship an `sk_` key in client source (KEY_TIERING.md).
- Open a web checkout for a digital good on Android or iOS (PROVIDERS_AND_STORES.md).
- Treat `BillingState.PaymentPending` as a failure (BILLING_STATE_SEMANTICS.md).
- Hand-write a repository / store / API wrapper around this SDK. Inject `PayCraftRepository`
  instead — that wrapper is the 670 LOC the facade exists to delete.
- Re-derive test/live in the host from a key prefix or build config. `PayCraft.mode` owns it.
- Credit a consumable balance locally, or let the host decide the granted quantity. The server is
  the only authority on what a purchase granted.
- Re-implement the consumable drain. Bind `onUnitsGranted` and let the SDK own the rest.
- Pick a plan by rank out of `plans`. Use `subscriptionPlans` — `plans` now contains coin packs.

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
