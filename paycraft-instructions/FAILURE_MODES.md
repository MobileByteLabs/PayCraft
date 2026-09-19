example-provenance: 9cb5162c248fb9426d460f2328ffda6882c29462

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
| F2 | Billing silently reports Free on a configured app | `startKoin` ran before `PayCraft.initialize`, so `PayCraftService` materialized with a null api key | heal | Reorder: `initialize` → `startKoin` (WIRING_CONTRACTS.md). This no longer crashes — it answers Free, which is harder to notice |
| F3 | `requireConfig()` throws | `initialize` never ran on this platform | heal | Move init into the shared `commonMain` seam; a per-platform init silently skips other targets |
| F4 | Billing works on Android only | `initialize` in the Android `Application` class | heal | Same as F3 — commonMain-first |
| F5 | Two `SupabaseClient`s collide / app auth session lost | The `named("paycraft")` qualifier was dropped | heal | Restore the qualifier |
| F6 | Paywall shows a skeleton on every open | `ConfigCache` not reachable, or `prefetchProducts()` never called | heal | Keep `ConfigCache` bound; call `prefetchProducts()` from splash/home |
| F6b | Host re-implements "is PayCraft set up?" from its own build config and disagrees with the SDK | `isConfigured` not used | heal | Read `PayCraft.isConfigured`; resolving `BillingManager` unconditionally is valid |

## Checkout and store lanes

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F7 | `CheckoutLane.Misconfigured("no provider configured for platform …")` | No routing rule names a primary provider for this platform, or the product has no id for it — so `/config` emitted a null `storeBinding` | heal | Set the platform's primary provider on the dashboard's Platform-providers page **and** give the product an id for it; re-fetch config |
| F8 | Integration reads `playProductId` / `appStoreProductId` and finds nothing | Those fields were replaced by the server-resolved `storeBinding` | heal | Read `plan.storeBinding` (PROVIDERS_AND_STORES.md); never reconstruct the pair client-side |
| F9 | Checkout opens a browser on Android/iOS for a digital plan | A hand-rolled checkout bypassed `resolveCheckoutLane` | heal | Route through `PayCraft.checkout` / the `BillingManager` purchase lanes |
| F10 | Native lane resolves but the store reports "product not found" | Id exists in the dashboard, absent or unapproved in the store | external | Create/activate the product in Play Console / App Store Connect; report the exact id |
| F10b | Lane resolves, checkout starts, store refuses — product in `MISSING_METADATA` or priced in 1 territory | A resolved lane was treated as a sellability verdict | external | Ask `/api/products/store-readiness`; quote the store's own blockers. All three cappy subscriptions resolved a lane while none could be sold (2026-09-17) |
| F11 | `NativeBillingClient` is `WebCheckoutNativeBillingClient` on iOS | Stale wiring — or a build that still tries to load `paycraftStoreKit2BillingModule`, which no longer exists | heal | Remove the module reference; iOS resolves `StoreKit2NativeBillingClient` automatically (the Swift shim is SDK-internal) |
| F12 | Wrong currency shown | Display price taken from `basePriceCents` instead of the native/resolved price | heal | Prefer `nativeDisplayPrice`, then `resolvedPrice`, then base; `PayCraft.activeRegion` is the single resolved (country, currency) |
| F13 | Purchase succeeds, entitlement never arrives | Transaction finished before reconciliation | heal | Finish only after the entitlement is reconciled |
| F14 | Best offer not shown (no trial) | Offer chosen by index instead of `selectBestOffer` | heal | Use `selectBestOffer(offers)` |
| F14b | Razorpay recurring plan: "no checkout URL for currency INR"; `live_payment_links` stays `{sku:{}}` after every re-sync | A recurring auth link is per-customer and cannot exist at catalogue-sync time | heal | Route through the `checkout-initiate` edge function; stop retrying the sync (WEBHOOKS.md) |

## Entitlement and state

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F15 | Buyer sees "payment failed" then buys again | `PaymentPending` rendered as `Error` | heal | Render the pending surface with **no retry** (BILLING_STATE_SEMANTICS.md) |
| F16 | Error toast whenever the store sheet is dismissed | `Free` treated as failure | heal | Cancellation lands in `Free` |
| F17 | Users lose access while their card retries | Only `active`/`trialing` treated as premium | heal | Honour `grace`, `on_hold`, `billing_retry` as still-entitled/recovering |
| F18 | Success sheet never appears | `subscriptionActivated` collected from a scope created after checkout | heal | Collect from a scope that outlives checkout — replay is 0 |
| F19 | Blank/wrong screen on some accounts | `DeviceConflict` / `OwnershipVerified` arms unhandled | heal | Implement the gate ladder including the explicit transfer confirmation |
| F20 | Another device silently deactivated | `confirmDeviceTransfer()` called without user confirmation | heal | Insert the confirmation step |
| F20b | OTP field rendered in the conflict flow, or a build referencing `verifyOtpOwnership` | The OTP gate was removed 2026-09-06 | heal | Delete the OTP arm; Gate 1 is OAuth, Gate 2 is support. Custom-domain emails now reach a human — that is the known cost, not a bug to work around |
| F21 | Trial CTA shown to a repeat user | `checkTrialEligibility()` not consulted | heal | Suppress the trial CTA when it returns false |
| F22 | Stale entitlement after a checkout return | `refreshStatus()` without `force` | heal | `refreshStatus(force = true)` on checkout return |
| F22b | Offline user sits on a spinner forever | Only `suiteConfigFlow` collected — null cannot distinguish loading / failed / stale | heal | Collect `configResultFlow`; render `StaleConfigNotice` / `ConfigUnavailable`, and offer retry only when `isRetryable` |

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
| F27b | A deploy/probe list fails on `otp-send-hook` | That function was removed with the OTP gate | heal | Drop it from the list |
| F28 | Function deployed, provider never calls it | Not registered provider-side | external | Register the URL (Play RTDN Pub/Sub push, ASSN V2 URL, provider dashboard) |
| F29 | Webhook 401/500 on every delivery | Signing secret or service-account credential missing | external | Materialize the credential as a function secret from the vault |
| F30 | Duplicate/competing entitlement rows | A path bypassed `reconcileEntitlement` | heal | Route every path through the shared reconcile with its `*ToCanonical` mapper |
| F31 | One purchase token grants several accounts | Replay guard skipped | heal | Call `assertPlayTokenNotReused` (Apple: the JWS/original-transaction equivalent) |
| F32 | Entitlement reflects a spoofed client body | Body trusted instead of re-fetched | heal | Re-fetch from the store's server API; the notification is only a signal |
| F32b | One edge function fails to deploy while the rest ship | A `deno.land/x` import in the bundle path | heal | Use platform WebCrypto; no third-party JWT library (it stopped `stripe-connect-oauth` deploying) |
| F32c | Headless onboarding needs `service_role`, or passes an owner id as an RPC parameter | No account-scoped credential was used | heal | Mint a `sk_acct_` key and exchange it at `account-token`; both shortcuts re-open the anon surface migrations 105/107 swept |

## Keys

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F33 | An `sk_`-tier credential found in app source | Secret pasted into the client | heal + **rotate** | Remove, rotate the credential, re-materialize at the function/CI consumer |
| F34 | Live buyers hit test payment links | `pk_test_` key in a release build | heal | Wire the `pk_live_` variant to the release build type |
| F35 | A `pk_` key flagged as a leak | Publishable key mistaken for a secret | — | Not a defect. Verify vault origin and build-type variant instead (KEY_TIERING.md) |
| F35b | A row in `account_api_keys` whose `key_hash` starts with `sk_acct_` | A code path stored the plaintext | heal + **rotate** | Hash through `_shared/account-key.ts`; the column's structural check should have refused it — find what bypassed it |

## Paywall UI

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F36 | Sheet paywall renders as an opaque full-screen takeover; host disappears | A root declares `fillMaxSize().background(…)` under `Sheet` mode | heal | Use `Modifier.paywallRoot(…)` / `Modifier.paywallContentSize()` |
| F37 | Sheet snaps to full height | Inner scroll column uses `fillMaxSize()` | heal | `Modifier.paywallContentSize()` |
| F38 | Terms / Privacy / Restore do nothing | Empty `onClick` lambdas | heal | Wire to `PaywallDto.termsUrl` / `privacyUrl` / the restore path |
| F39 | Store review rejects for a missing restore path | No restore affordance | heal | Add `PayCraftRestore` or a bespoke restore action |
| F40 | Bespoke paywall verified against bundled-UI assertions (or the reverse) | Path detection skipped | heal | Detect the path (imports of `com.mobilebytelabs.paycraft.ui`) and assert that path only |
| F41 | Build references `BrandedStackTemplate` / `MinimalTemplate` / `DarkTemplate` / `PremiumTemplate` | Those four Kotlin templates were deleted | heal | The state machine is `PaywallStateHost`; the layouts are seed trees. `PaywallDto.template` is a seed selection now (PAYWALL_CUSTOMIZATION.md) |
| F42 | Price renders outside a plan card's background/border, or a tenant cannot move it | Price drawn as a renderer overlay instead of authored copy | heal | Use the `{{ product.price }}` variable in a `text` node inside the card |
| F43 | Paywall renders a headline and CTA with no plans | `availableRoles` filtered to empty | heal | Never pass an empty role set — show the authored plans; a genuinely empty catalogue is a different branch |
| F44 | `ExceptionInInitializerError` the first time the paywall opens — on device only, after a fully green JVM suite | A regex literal valid under `java.util.regex` but rejected by Android's stricter engine, thrown from a static initializer | heal | Escape both braces on both sides; keep the `PATTERN_HAS_NO_UNESCAPED_BRACES` guard. **JVM-green is not a paywall verdict** |
| F45 | A newer published tree takes the whole config down | The tree was decoded as a typed model | heal | Keep `workflow` as `JsonElement` and let `PaywallTreeParser` degrade node-by-node to `Unknown` |
| F46 | Ringed plan and purchased plan disagree | Default selection applied by styling the card | heal | Apply it through `SelectPlan`, and read the **effective** workflow (tree ?: seed) — reading the tenant tree alone silently does nothing for an app with no published tree |
| F47 | Trial paywall rejected by Play Subscriptions policy | Trial length / post-trial price / cancellation not stated | heal | Render `trialTermsTemplate` / `trialDisclosureTitle` / `trialDisclosureBody` (blank falls back to the SDK's localized default) |

## Verification integrity

| # | Symptom | Root cause | Class | Remedy |
|---|---|---|:--:|---|
| F48 | A step reports green with no evidence | Verdict asserted, not observed | — | A pass requires a fresh capture/probe output; "should work" is not a verdict |
| F49 | A step is green because its evidence counted rows | Existence evidence answering a completeness claim | — | Evidence EXISTS ≠ evidence is TRUE. `{count: 3, read_back: true}` was accurate while every product was unsellable |
| F50 | One platform's verdict inherited by another | Per-platform verdicts collapsed | — | Verdicts are per-platform and never cross-inherit |
| F51 | Corpus disagrees with the SDK | Corpus stale | heal | Re-fold via `/paycraft-dev fold` before integrating (PCA-4) |
| F52 | Corpus version ≠ resolved artifact version | `corpus-artifact-mismatch` | heal | Align the consumer's `cmp-paycraft` version, or re-fold + publish. On a `/lib-integrate` composite link there is no artifact version — the gate compares `sdk_head_commit` against source HEAD instead |
