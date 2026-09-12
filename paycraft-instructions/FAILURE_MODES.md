example-provenance: 518e84790cc2794f1cd4007182d72005ae07fe56

# FAILURE_MODES.md — enumerated integration failures and their source-level remedies

> Consumed by `/idea-paycraft`'s auto-heal loop. Authored by `/paycraft-dev fold`.
>
> Every remedy below fixes the **source** of the failure. Weakening an assertion, deleting a check,
> downgrading a probe, or stubbing a handler to make a step go green is forbidden — it hides the
> defect the step exists to find.

Legend for **Class**: `heal` = the run fixes it autonomously; `external` = blocked on something
outside the repo (an account, a credential, a store review), reported with its reason and logged,
never faked green and never spun on.

## Initialization and wiring

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F1 | `IllegalArgumentException: apiKey must start with pk_test_ or pk_live_` | Placeholder/blank publishable key | heal | Materialize the `pk_` key for this build type (KEY_TIERING.md) and wire it into the shared init |
| F2 | `error("PayCraft.initialize(apiKey) must be called before resolving PayCraftService")` at Koin resolution | `startKoin` runs before `PayCraft.initialize` | heal | Reorder: `initialize` → `startKoin` (WIRING_CONTRACTS.md) |
| F3 | `requireConfig()` throws | `initialize` never ran on this platform | heal | Move init into the shared `commonMain` seam; a per-platform init silently skips other targets |
| F4 | Billing works on Android only | `initialize` in the Android `Application` class | heal | Same as F3 — commonMain-first |
| F5 | Two `SupabaseClient`s collide / app auth session lost | The `named("paycraft")` qualifier was dropped | heal | Restore the qualifier |
| F6 | Paywall shows a skeleton on every open | `ConfigCache` not reachable, or `prefetchProducts()` never called | heal | Keep `ConfigCache` bound; call `prefetchProducts()` from splash/home |

## Checkout and store lanes

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F7 | `CheckoutLane.Misconfigured("Google Play product not configured")` | `ProductDto.playProductId` blank | heal | Set the Play product id on the dashboard product row; re-fetch config |
| F8 | `CheckoutLane.Misconfigured("App Store product not configured")` | `ProductDto.appStoreProductId` blank | heal | Set the App Store product id on the dashboard product row |
| F9 | Checkout opens a browser on Android/iOS for a digital plan | A hand-rolled checkout bypassed `resolveCheckoutLane` | heal | Route through `PayCraft.checkout` / the `BillingManager` purchase lanes |
| F10 | Native lane resolves but the store reports "product not found" | Id exists in the dashboard, absent or unapproved in the store | external | Create/activate the product in Play Console / App Store Connect; report the exact id |
| F11 | `NativeBillingClient` is `WebCheckoutNativeBillingClient` on iOS | `paycraftStoreKit2BillingModule` never loaded | heal | `loadKoinModules(paycraftStoreKit2BillingModule)` after `PayCraftModule` |
| F12 | Wrong currency shown | Display price taken from `basePriceCents` instead of the native/resolved price | heal | Prefer `nativeDisplayPrice`, then `resolvedPrice`, then base |
| F13 | Purchase succeeds, entitlement never arrives | Transaction finished before reconciliation | heal | Finish only after the entitlement is reconciled |
| F14 | Best offer not shown (no trial) | Offer chosen by index instead of `selectBestOffer` | heal | Use `selectBestOffer(offers)` |

## Entitlement and state

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F15 | Buyer sees "payment failed" then buys again | `PaymentPending` rendered as `Error` | heal | Render the pending surface with **no retry** (BILLING_STATE_SEMANTICS.md) |
| F16 | Error toast whenever the store sheet is dismissed | `Free` treated as failure | heal | Cancellation lands in `Free` |
| F17 | Users lose access while their card retries | Only `active`/`trialing` treated as premium | heal | Honour `grace`, `on_hold`, `billing_retry` as still-entitled/recovering |
| F18 | Success sheet never appears | `subscriptionActivated` collected from a scope created after checkout | heal | Collect from a scope that outlives checkout — replay is 0 |
| F19 | Blank/wrong screen on some accounts | `DeviceConflict` / `OwnershipVerified` arms unhandled | heal | Implement the gate ladder including the explicit transfer confirmation |
| F20 | Another device silently deactivated | `confirmDeviceTransfer()` called without user confirmation | heal | Insert the confirmation step |
| F21 | Trial CTA shown to a repeat user | `checkTrialEligibility()` not consulted | heal | Suppress the trial CTA when it returns false |
| F22 | Stale entitlement after a checkout return | `refreshStatus()` without `force` | heal | `refreshStatus(force = true)` on checkout return |

## Realtime

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F23 | Dashboard product/price edits never reach the app | Config channel not subscribed | heal | Subscribe `config:{tenantId}` once `tenantId` is known |
| F24 | Entitlement updates stop after login | Entitlement channel not re-subscribed when `appUserId` flips device-id → email | heal | Re-subscribe on identity change |
| F25 | Realtime silently stops after a socket drop | Liveness tested as `channel != null` | heal | Test the channel's subscribed status; `resubscribe()` on foreground |
| F26 | Realtime cannot connect at all | Network/project-level block | external | Report `realtime: degraded` with the reason; the TTL/foreground refresh path still converges |

## Webhooks and server

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F27 | Webhook URL returns 404 | Function not deployed | heal | Deploy the function |
| F28 | Function deployed, provider never calls it | Not registered provider-side | external | Register the URL (Play RTDN Pub/Sub push, ASSN V2 URL, provider dashboard) |
| F29 | Webhook 401/500 on every delivery | Signing secret or service-account credential missing | external | Materialize the credential as a function secret from the vault |
| F30 | Duplicate/competing entitlement rows | A path bypassed `reconcileEntitlement` | heal | Route every path through the shared reconcile with its `*ToCanonical` mapper |
| F31 | One purchase token grants several accounts | Replay guard skipped | heal | Call `assertPlayTokenNotReused` (Apple: the JWS/original-transaction equivalent) |
| F32 | Entitlement reflects a spoofed client body | Body trusted instead of re-fetched | heal | Re-fetch from the store's server API; the notification is only a signal |

## Keys

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F33 | An `sk_`-tier credential found in app source | Secret pasted into the client | heal + **rotate** | Remove, rotate the credential, re-materialize at the function/CI consumer |
| F34 | Live buyers hit test payment links | `pk_test_` key in a release build | heal | Wire the `pk_live_` variant to the release build type |
| F35 | A `pk_` key flagged as a leak | Publishable key mistaken for a secret | — | Not a defect. Verify vault origin and build-type variant instead (KEY_TIERING.md) |

## Paywall UI

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F36 | Sheet paywall renders as an opaque full-screen takeover; host disappears | A root declares `fillMaxSize().background(…)` under `Sheet` mode | heal | Use `Modifier.paywallRoot(…)` / `Modifier.paywallContentSize()` |
| F37 | Sheet snaps to full height | Inner scroll column uses `fillMaxSize()` | heal | `Modifier.paywallContentSize()` |
| F38 | Terms / Privacy / Restore do nothing | Empty `onClick` lambdas | heal | Wire to `PaywallDto.termsUrl` / `privacyUrl` / the restore path |
| F39 | Store review rejects for a missing restore path | No restore affordance | heal | Add `PayCraftRestore` or a bespoke restore action |
| F40 | Bespoke paywall verified against bundled-UI assertions (or the reverse) | Path detection skipped | heal | Detect the path (imports of `com.mobilebytelabs.paycraft.ui`) and assert that path only |

## Verification integrity

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F41 | A step reports green with no evidence | Verdict asserted, not observed | — | A pass requires a fresh capture/probe output; "should work" is not a verdict |
| F42 | One platform's verdict inherited by another | Per-platform verdicts collapsed | — | Verdicts are per-platform and never cross-inherit |
| F43 | Corpus disagrees with the SDK | Corpus stale | heal | Re-fold via `/paycraft-dev fold` before integrating (PCA-4) |
| F44 | Corpus version ≠ resolved artifact version | `corpus-artifact-mismatch` | heal | Align the consumer's `cmp-paycraft` version, or re-fold + publish |
