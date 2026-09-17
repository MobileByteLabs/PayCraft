example-provenance: 518e84790cc2794f1cd4007182d72005ae07fe56

# WIRING_CONTRACTS.md — DI, initialization order, and the repository seam

> Consumed by `/idea-paycraft` chain step 5 (client wiring). Authored by `/paycraft-dev fold`.

## The one initialization order that works

```
1. PayCraft.initialize(apiKey, backend, options, mode)     // synchronous; captures apiKey + backend
2. startKoin { modules(PayCraftModule, …app modules) }     // or add PayCraftModule to an existing startKoin
3. (Android only, optional) loadKoinModules(paycraftPlayBillingModule)
   (iOS only,     optional) loadKoinModules(paycraftStoreKit2BillingModule)
4. app UI composes; BillingManager resolves lazily
```

**Why this order is not negotiable.** `PayCraftModule`'s `SupabaseClient` singleton reads
`PayCraft.backend`, and its `PayCraftService` singleton reads `PayCraft.apiKey` — both with an
`error(...)` if unset. Both are set synchronously inside `initialize`. They deliberately do **not**
call `requireConfig()`, because `config` is only fully populated after the async `/config` fetch
resolves, which happens later than Koin's lazy singleton materialization. So: `initialize` before
`startKoin`, and never gate Koin startup on the config arriving.

## commonMain-first (hard)

`PayCraft.initialize` and the Koin wiring belong in the **shared** `commonMain` app-init seam
(`initKoin` in `cmp-shared` for a kmp-project-template fork), not in an Android `Application`
subclass or an iOS `AppDelegate`. A per-platform init means iOS/desktop/web silently run without
billing and the defect only shows up on the platform nobody tested.

Platform-specific pieces are additive Koin modules layered on top, never a second `initialize`.

## What `PayCraftModule` provides

| Binding | Implementation | Notes |
|---|---|---|
| `SupabaseClient` (qualifier `named("paycraft")`) | `createSupabaseClient` with `Postgrest`, `Auth`, `Realtime` | Qualified — it will not collide with the app's own `SupabaseClient` |
| `PayCraftService` | `PayCraftServiceImpl(client, apiKey)` | RPC seam; see below |
| `PayCraftStore` | `PayCraftSettingsStore()` | Email + subscription cache (multiplatform-settings) |
| `PayCraftRealtime` | wraps the qualified `SupabaseClient` | Broadcast invalidation pings |
| `NativeBillingClient` | `platformDefaultNativeBillingClient() ?: WebCheckoutNativeBillingClient()` | Android resolves real Play Billing automatically |
| `EntitlementCache` | `EntitlementCache(service, SettingsEntitlementDao())` | Store5 read-through + offline last-known-good |
| `EntitlementRepository` | `EntitlementRepository(cache, native, service)` | The repository seam |
| `BillingManager` | `PayCraftBillingManager(service, store, repo, nativeBillingClient)` | The headless surface |
| `ConfigCache` | `ConfigCache(Settings())` | Persistent `SuiteConfig` cache — what makes a cold/offline start render real products |
| `HttpClient` | Ktor + `ContentNegotiation(json)` | |
| `CouponClient` | | |
| `PayCraftPaywallViewModel` | `viewModelOf` | Only needed by the bundled paywall |

**The qualifier matters.** Because the `SupabaseClient` is registered under
`named("paycraft")`, an app that already binds its own unqualified `SupabaseClient` keeps it. Do not
"simplify" by dropping the qualifier — that is how a consumer's auth session ends up on PayCraft's
project (or vice versa).

## `NativeBillingClient` — the platform seam

`platformDefaultNativeBillingClient()` is an `expect`/`actual`:

- **Android** → real Google Play Billing. Context and Activity are captured automatically by
  `PayCraftInitializer` (androidx-startup), so a `commonMain`-only consumer needs no androidMain code.
- **iOS / desktop / web / js** → returns null, and the module falls back to
  `WebCheckoutNativeBillingClient` (a no-op that reports `Web`).

Opt-in overrides, loaded **after** `PayCraftModule`:

- `paycraftStoreKit2BillingModule` (iOS) — binds the StoreKit 2 client backed by the Swift shim
  `PayCraftStoreKit2.swift` (`startTransactionUpdates`, `finish`, `introOffer`).
- `paycraftPlayBillingModule` (Android) — for a custom `activityProvider`.

If neither native lane is wired on a native-store platform, every digital checkout resolves to
`CheckoutLane.Misconfigured` and is **blocked**, not silently redirected to a browser.

## `tenantId` lifecycle

`tenantId` is **server-assigned**, arrives on `SuiteConfig.tenantId`, and is never configured by the
client. It is null-equivalent until the first config lands (cached or fetched), so:

- Realtime subscription is deferred until `suiteConfig?.tenantId` is non-null. Channels are
  `config:{tenantId}` and `entitlement:{tenantId}:{appUserId}`.
- `appUserId` is the lowercased trimmed email when known, else `PayCraft.deviceId`. When identity
  flips from device-id to email (`registerAndLogin`), the entitlement channel **re-subscribes** —
  a wiring that skips that re-subscribe leaves realtime pointed at the anonymous channel forever.
- `PayCraftRealtime.resubscribe()` on app foreground; `stop()` on logout/teardown. The liveness
  check is on the channel's actual subscribed status, not on `channel != null` (a dead channel stays
  non-null and silently stops delivering).

## The repository seam

`EntitlementRepository(cache, native, service)` is the single place read paths converge:
Store5 `EntitlementCache` for read-through + offline truth, `NativeBillingClient` for store-side
purchases/restore, `PayCraftService` for server truth. A consumer that wants its own entitlement
gating should read `BillingManager.isPremium` / `billingState`, not reach past it into the cache.

## Verification an integrator can run

- `PayCraft.apiKey` non-null immediately after `initialize` (synchronous capture).
- `getKoin().get<BillingManager>()` resolves without throwing.
- `getKoin().get<NativeBillingClient>()` is NOT `WebCheckoutNativeBillingClient` on Android/iOS when
  the app ships digital subscriptions.
- `PayCraft.suiteConfigFlow.value?.tenantId` non-null after the first successful `/config`.
