# Migrating to PayCraft 3.0

3.0 splits the SDK into a logic module and a UI module so the apps and the web SDK run ONE implementation of
config, region pricing, identity, entitlement, device registration and checkout routing. For a KMP app the
upgrade is a version bump plus, at most, the two items under **Breaking changes**.

## Module map

| Artifact | What it is | Depend on it when |
|---|---|---|
| `cmp-paycraft-core` | Config + region pricing, identity, entitlement / ad-free, device registration, checkout routing, persistence, the `PayCraft` entry point. No Compose. android · ios · jvm · js · wasmJs | You need the logic without the paywall UI (custom UI, server-side Kotlin) |
| `cmp-paycraft` | The Compose paywall, gates, theme — over core (`api` dependency, so core comes with it) | KMP apps — **unchanged coordinates and imports** |
| `cmp-paycraft-navigation` | Navigation Compose destination for the paywall | Unchanged |
| `cmp-paycraft-web` | `@JsExport` browser SDK over core (`PayCraftWeb`). Not on Maven — vendored into a site with `/lib-integrate` | Plain-JS / TypeScript websites |

Package names are unchanged (`com.mobilebytelabs.paycraft.*`). An app that depends on `cmp-paycraft` keeps
compiling: `import com.mobilebytelabs.paycraft.PayCraft` now resolves from core through `cmp-paycraft`.

```toml
[libraries]
paycraft = { module = "io.github.mobilebytelabs:cmp-paycraft", version.ref = "paycraft" }            # UI (brings core)
paycraft-core = { module = "io.github.mobilebytelabs:cmp-paycraft-core", version.ref = "paycraft" }  # logic only
```

## Breaking changes

### `BillingBenefit` is Compose-free

The logic module has no Compose, so a benefit is an icon **key** plus plain text; `cmp-paycraft` maps the key to
the Material vector when it renders.

```kotlin
// 2.5.x
BillingBenefit(icon = Icons.Filled.Block, text = Res.string.my_no_ads_string)
// 3.0.0
BillingBenefit(icon = BenefitIcon.Block, text = "No ads, anywhere")
```

`BenefitIcon` = `AllInclusive`, `Block`, `HighQuality`, `Shield`, `NewReleases`, `Check`. In UI code,
`BenefitIcon.imageVector` gives the vector and `BillingBenefit.localizedText()` the text to show.

The `PayCraftBenefits` presets (`unlockAll`, `adFree`, `hdDownloads`, `prioritySupport`, `earlyAccess`,
`standard`, `full`) still render in the app's language: the UI looks them up by value. A **copy** of a preset
(`PayCraftBenefits.adFree.copy(icon = BenefitIcon.Check)`) is a different value and renders its English
`text` — localise your own benefits with your own strings.

### The paywall ViewModel binding moved to `PayCraftUiModule`

`PayCraftModule` (core) no longer declares `viewModelOf(::PayCraftPaywallViewModel)`; it lives in
`PayCraftUiModule` in `cmp-paycraft`, and **the paywall composables load it themselves** on first use, once per
Koin instance. Apps that include `payCraft(...)` or `PayCraftModule` change nothing. If your own code resolves
`PayCraftPaywallViewModel` before any paywall is shown (unusual — it is `internal`), add `PayCraftUiModule` to
your Koin modules.

### One subscription, up to N devices (server migration 178)

A subscription can now be active on more than one device at a time — any mix of Android, iOS, web and
desktop — up to the app's `max_active_devices` (a per-app setting, default **1**, so an app that does not
change it behaves exactly as before). At the limit, signing in on another device lists the devices that
hold the seats and the buyer signs one out to continue; any signed-in device can also list and sign out
devices at any time:

| | App (cmp-paycraft) | Web (`PayCraftWeb`) |
|---|---|---|
| At the limit | `BillingState.DeviceConflict/OwnershipVerified.activeDevices` + `maxDevices`; the paywall lists them, `PayCraftPaywallAction.RemoveDeviceAndTransfer(ref)` | `activeDevices()`, `maxDevices()`, `useThisDeviceInstead(ref)` after a conflicting `signIn` |
| Manage devices | `PayCraftManageDevices()` composable · `PayCraftRepository.activeDevices()` / `signOutDevice(ref)` | `devices()` · `signOutDevice(ref)` |

Devices are named by `ActiveDevice.ref` (the registration id) — never by another device's token.
**Binary note:** `RegisterDeviceResult`, `BillingState.DeviceConflict` and `BillingState.OwnershipVerified`
gained defaulted fields, so their constructors and `copy` changed shape (source-compatible; recompile).

## Behaviour notes

- **`BillingManager` is SDK-internal.** It was already `internal` in 2.5.x; in 3.0 it is public only behind the
  `@PayCraftInternalApi` opt-in (it crosses the core/UI module boundary). Apps should use `PayCraft`
  (`isAdFree`, `products`, `checkout`, …) and the `PayCraftRepository`; code written against 2.3.x that
  imports `core.BillingManager` must move to those.
- **Compose stability.** Core is built without the Compose compiler, so its model classes (`BillingState`,
  `BillingPlan`, `SubscriptionStatus`, `Product`, `SuiteConfig`, …) carry no stability metadata. `cmp-paycraft`
  declares them stable through `cmp-paycraft/compose-stability.conf`. If YOUR composables take these types as
  parameters and you rely on skipping, add the same file to your module:
  ```kotlin
  composeCompiler { stabilityConfigurationFiles.add(rootProject.layout.projectDirectory.file("compose-stability.conf")) }
  ```
- **JS (browser + Node).** The device token is now actually persisted on JS (2.5.x lost it: a `js("…")` snippet
  referenced a renamed parameter), and the SDK no longer crashes on Node.js, where there is no `localStorage`
  (an in-memory store is used instead).

## Web SDK (`cmp-paycraft-web`)

The exported API (`PayCraftWeb` and its classes), error codes and localStorage keys (`paycraft_web_token`,
`paycraft_web_email`, `paycraft_web_premium` `{isPremium,email,at}`, `paycraft_web_device_id`, 6 h cache) are
unchanged. Underneath it now runs core's `PayCraftContract`, so two things follow the app:

- a product without `trial_duration_days` reports `trialDays = 7` (core's default, what the app shows), not `null`;
- `/config` is decoded with the app's model, tolerantly: the paywall block is not decoded on the web, a malformed
  product or provider is skipped (a malformed `resolved_price` falls back to the base price) instead of failing
  the whole call, and products missing `id` / `type` / `display_name` still load, as in 2.5.x.

Size: 140 KB minified + gzipped for the 11 files a page loads (2.5.x: 88 KB); `:cmp-paycraft-web:webBundleSize`
fails the build above 150 KB.

## Wasm notes

`wasmJsMain` now has a Ktor engine (`ktor-client-js`), so `HttpClient()` works on wasm. No expect/actual was
replaced by a no-op for wasm in 3.0; the wasm actuals are the same as 2.5.x plus `platformSettings()`
(browser `localStorage`).
