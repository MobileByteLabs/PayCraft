example-provenance: 518e84790cc2794f1cd4007182d72005ae07fe56

# PAYWALL_CUSTOMIZATION.md — the two supported paywall paths

> Consumed by `/idea-paycraft` chain step 6. Authored by `/paycraft-dev fold`.

There are exactly **two** supported ways to ship a paywall. Both are first-class; a consumer picks one
per app. There is no third "partially custom" path — mixing PayCraft templates with hand-rolled
surface ownership is what produced the blank-background class of bug.

---

## Path A — cloud-templated (bundled composables)

The host renders a PayCraft composable; everything visual comes from `SuiteConfig.paywall`
(`PaywallDto`) so a dashboard change reaches the app on the next `/config` fetch with no release.

**Entry points**

| Composable | Surface | Use when |
|---|---|---|
| `PayCraftPaywall(…)` | full screen | the paywall is a destination |
| `PayCraftPaywallSheet(…)` | modal bottom sheet | the paywall interrupts a flow |
| `PayCraftSheet(visible, onDismiss, modifier)` | sheet wrapper | simplest drop-in |
| `PayCraftBanner` / `PayCraftInlinePaywallBanner` / `BannerPaywall` | inline | contextual upsell |
| `PayCraftPremiumBanner` | inline | already-premium state |
| `PayCraftPremiumGuard` / `PayCraftPremiumGuardInline` | wrapper | gate a screen or a region |
| `PayCraftRestore` / `PayCraftRestoreContent` | screen / content | restore purchases |
| `PayCraftCheckoutSuccessSheet` / `…OrPaywall` | sheet | post-purchase confirmation |

**Templates** — `PaywallDto.template` selects one of `branded-stack` (default), `minimal`, `dark`,
`premium`, implemented under `presentation/templates/`.

**Theme + copy from cloud** — `themeJsonb`, `primaryColor`, `fontFamily`, `branding`,
`heroTitle`, `heroSubtitle`, `valueProps[]` (icon/title/description), `ctaContinue`,
`ctaGetPremium`, `restoreLabel`, `termsUrl`, `privacyUrl`, `popularPlanSku`, `successTitle`,
`customFooter`.

### The surface-mode contract (the blank-background fix)

`PayCraftSurfaceMode` decides **who owns bounds and background**. Exactly one layer paints.

```kotlin
enum class PayCraftSurfaceMode { FullScreen, Sheet }
val LocalPayCraftSurfaceMode = staticCompositionLocalOf { PayCraftSurfaceMode.FullScreen }

@Composable @ReadOnlyComposable
fun Modifier.paywallRoot(background: Color): Modifier      // FullScreen: fillMaxSize + background
                                                            // Sheet:      fillMaxWidth only
@Composable @ReadOnlyComposable
fun Modifier.paywallContentSize(): Modifier                 // sizing-only variant, no paint
```

A paywall inside a `ModalBottomSheet` sits in a slot the sheet already sizes, shapes, colours and
scrims. If the paywall *also* declares `fillMaxSize()` and paints an opaque background, it expands
the sheet to the full window and covers the scrim — the host disappears and the "sheet" reads as an
opaque takeover. `PayCraftPaywallSheet` provides `Sheet`; `PayCraftPaywall` provides `FullScreen`;
the default is `FullScreen` so a template rendered standalone (previews, screenshot tests) keeps
its self-painting behaviour.

**Rules for anyone writing a template or embedding one:**

1. Never write a bare `fillMaxSize().background(x)` at a paywall root — use `Modifier.paywallRoot(x)`.
2. Never write a bare `fillMaxSize()` on an inner scroll column — use `Modifier.paywallContentSize()`;
   a full-height scroll column forces the sheet open just as a painted root does.
3. Never nest a PayCraft sheet composable inside another modal sheet.
4. A host that supplies its own container must provide `LocalPayCraftSurfaceMode = Sheet`.

**Verification (device-truth):** a sheet paywall is correct when a fresh capture, taken after
`am force-stop`, shows host content visible above the sheet with the scrim between them. A
screenshot showing an opaque full-window paywall is a failure even if the composable tree compiles.

---

## Path B — generated bespoke UI against the headless surface

The app owns every pixel and consumes only `BillingManager`. Nothing from
`com.mobilebytelabs.paycraft.ui` or `.presentation` is imported.

**Minimum contract a bespoke paywall must satisfy** — this is what `/idea-paycraft` asserts, and each
item is a real failure mode, not a style preference:

| # | Requirement | Why |
|---|---|---|
| B1 | Render every `BillingState` arm, including `PaymentPending`, `DeviceConflict`, `OwnershipVerified` | Unhandled arms render as a blank or wrong screen |
| B2 | `PaymentPending` shows a "payment processing" surface with **no retry affordance** | A retry button here is the duplicate-purchase bug |
| B3 | Buy CTA calls `purchaseViaPlayBilling` / `purchaseViaStoreKit` per platform, never a browser URL | Store anti-steering policy |
| B4 | A visible **Restore** action calling the restore path | Both stores require it |
| B5 | Terms and Privacy links wired to `PaywallDto.termsUrl`/`privacyUrl` | Store review requirement; empty lambdas were a real shipped defect |
| B6 | Prices rendered from resolved/native display price, not hardcoded | Wrong currency in other storefronts |
| B7 | Trial copy driven by `isInTrial`/`trialEndsAt`, and CTA suppressed when `checkTrialEligibility()` is false | Offering a consumed trial misleads repeat users |
| B8 | `subscriptionActivated` collected from a scope that outlives checkout | Replay is 0 — a late collector misses the event |
| B9 | Every interactive element reachable and non-dead | `onClick = { }` is a shipped-stub failure |

**Prices.** Prefer the native display price (`NativeBillingClient.nativeDisplayPrice`) on Android/iOS
so the buyer sees exactly what the store will charge; fall back to `ProductDto.resolvedPrice`, then to
`basePriceCents`/`baseCurrency`.

---

## Choosing a path

Cloud-templated is the default: it is dashboard-updatable and already satisfies B1–B9. Choose bespoke
when the paywall must match a bespoke design system. `/idea-paycraft` detects which path an app is on
by whether it imports `com.mobilebytelabs.paycraft.ui`, and verifies that path's assertions only —
per-path, never cross-inherited.
