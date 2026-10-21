example-provenance: d17c43b42c05b30b9029e3cbcbbfa314a8bd372b

# PAYWALL_CUSTOMIZATION.md — the two supported paywall paths

> Consumed by `/idea-paycraft` chain step 6. Authored by `/paycraft-corpus-fold`.

There are exactly **two** supported ways to ship a paywall. Both are first-class; a consumer picks one
per app. There is no third "partially custom" path — mixing PayCraft rendering with hand-rolled
surface ownership is what produced the blank-background class of bug.

---

## Path A — cloud-rendered (bundled composables)

The host renders a PayCraft composable; everything visual comes from `SuiteConfig.paywall`
(`PaywallDto`) so a dashboard change reaches the app on the next `/config` fetch with no release.

**Entry points**

| Composable | Surface | Use when |
|---|---|---|
| `PayCraftPaywall(…)` | full screen | the paywall is a destination |
| `PayCraftPaywallSheet(…)` | modal bottom sheet | the paywall interrupts a flow |
| `PayCraftSheet(visible, onDismiss, modifier)` | sheet wrapper | simplest drop-in |
| `PayCraftPaywallWithRestore(onDismiss, modifier)` | screen | paywall + restore in one surface |
| `PayCraftPlanBanner(style)` | inline | the billing banner — `Adaptive` (default) shows a subscriber their plan, `Upsell` renders nothing for them |
| `PayCraftInlinePaywallBanner` / `BannerPaywall` | inline | contextual upsell |
| `PayCraftGate` | wrapper | gate a screen or a region — REPLACES the content with the SDK's offer |
| `PayCraftTeaseGate` | wrapper | the content stays visible and readable; only the TAP is shielded |
| `PayCraftAdGate` | wrapper | unlockable by watching an ad as well as by subscribing |
| — | — | restore is presented BY the SDK (banner link, `PayCraftPlanSection` row); `PayCraftRestore` is internal |
| `PayCraftPlanSection(style, theme, header)` | inline | subscription section for a settings screen — status, manage, restore (five styles; see below) |
| `PayCraftCheckoutSuccessSheet` / `…OrPaywall` | sheet | post-purchase confirmation |
| `ProductList(…)` | list | plan stack on its own |
| `PayCraftStoreSection(modifier)` | inline | the CONSUMABLE store — coin/credit packs, prices, and checkout, all the SDK's |
| `PayCraftProductGate` | wrapper | gate on OWNING a one-time product rather than on a subscription |
| `PayCraftBalance` | inline | the host's unit balance, where the host wants it |

**`PayCraftStoreSection` takes no purchase callback, deliberately.** It calls
`PayCraftRepository.checkout` itself. A host-callback surface shipped once with a dead upgrade row:
it reported `clickable=true`, its handler ran, its golden matched, its logic tests passed — and only
an on-device render caught that nothing happened. A surface that owns its own presentation cannot
fail that way.

It lists only the non-subscription catalogue, because a store that offers a plan beside a coin pack
invites a user to buy a subscription they may already hold. It also shows **no per-row balance**: a
pack's balance is the balance of the currency it GRANTS, not of the pack sku, and only the host
knows how to present its own currency — render `PayCraftBalance` (or read `repository.balances`)
wherever that belongs in your chrome.

An empty render ("No products available") is a CONFIGURATION state, not an error — a tenant may sell
only subscriptions. If you expect packs and see that message, start at FAILURE_MODES F53/F54.

The three gates replace `PayCraftPremiumGuard`, `PayCraftPremiumGuardInline` and
`PayCraftPaywallGuardScreen`, all now `@Deprecated` — see PUBLIC_API.md § Gates. A guard renders a
HOST-authored lock screen, so its copy restates the offer in app code and drifts from the dashboard;
a gate presents the SDK's own paywall from the published workflow. Do not wire a new integration to
a guard.

### What actually renders: one state machine + a component tree

The four Kotlin templates (`BrandedStackTemplate`, `MinimalTemplate`, `DarkTemplate`,
`PremiumTemplate`) **are gone**. Each of them owned a `when (state)` over every `BillingState` arm,
and six of those arms were effectively identical across all four — Loading was the same skeleton,
PaymentPending / DeviceConflict / OwnershipVerified already delegated to the same shared components,
Premium and Error differed only in wording no tenant chose and none could change. Only the **Free**
arm genuinely varied, and that is precisely the part a component tree expresses.

So the four templates were one state machine plus four layouts, and each half now lives once:

- **The state machine** is `PaywallStateHost(state, workflow, context)` — the single `when
  (BillingState)`, shared by every surface.
- **The layouts** are component trees: `PaywallWorkflow` → `PaywallStep` → `PaywallNode`.

**Resolution order, decided in `PayCraftPaywallComposable` (not inside a template — the question is
*which renderer*, not *how this template draws*):**

```
config.paywall.workflow   (tenant's PUBLISHED tree, JsonElement)
  └─ parse fails or absent →  BuiltInPaywallSeeds.workflow(template)   (bundled seed JSON)
        └─ both null → the error surface with a retry, never a blank sheet
```

`PaywallDto.template` is therefore a **seed selection**, not a second rendering path. A tenant who
published a tree is unaffected; one who never did gets the same design, rendered by the renderer
instead of by a hand-written twin. `PaywallTemplate.{MINIMAL,PREMIUM,DARK}` remain as `@Deprecated`
seed names (removal in cmp-paycraft 3.0.0); `BRANDED_STACK` is the default and `parse()` falls back
to it for any unknown value.

### The tree contract

```kotlin
data class PaywallWorkflow(
    schemaVersion: Int, initialStepId: String, steps: List<PaywallStep>,
    localizations: Map<String, Map<String, String>>, colorScheme: String = "light",
)
data class PaywallStep(id, name, isLastStep, root: PaywallNode?)
```

`PaywallNode` variants: `Stack` (axis/spacing/padding/margin/background/corner/border),
`Text(textLid, …)`, `Image`, `Icon`, `Package(roleIdentifier, isSelectedByDefault, stack)`,
`Button(labelLid, action)`, `PurchaseButton`, `RestorePurchases`, `Footer(sticky)`,
`Timeline`/`TimelineItem`, `Spacer`, and `Unknown(type)`.

Four properties of this design are load-bearing, and each exists because of a specific failure:

1. **`workflow` is carried as `JsonElement`, not a typed model.** The SDK must survive receiving a
   *newer* tree than it understands. kotlinx would reject an unknown node shape at deserialization
   and take the **whole config** down with it; `PaywallTreeParser` walks it leniently and degrades
   node-by-node to `Unknown`. Config decoding is the wrong place to be strict. `SUPPORTED_SCHEMA_VERSION`
   is **2**, and `isForwardVersion` tells a caller it is looking at a newer tree.
2. **The field is nullable and additive on purpose.** Every already-released SDK ignores it, and a
   tenant with no published tree gets `null` — so there is no coordinated rollout and no version
   negotiation. `/config` sources it from `published_workflow` only; a draft can never arrive.
3. **Copy carries variables; the renderer does not draw prices.** Price used to be an *overlay* the
   renderer positioned in a corner of every package card — so a card with a short authored stack
   rendered its price **outside** its own background and border (obvious the moment a selected-state
   ring was drawn), and price placement was the one thing a tenant could not move. Now a `text` node
   whose lid resolves to `{{ product.price }}` sits wherever the author put it, inheriting the card's
   layout and clipping. The closed set is `product.price`, `product.price_per_period`,
   `product.offer_savings`, `product.offer_savings_label`; an unknown variable resolves to **empty**,
   never to its own braces — a typo must not print `{{ product.whatver }}` at a paying customer, so
   it is caught upstream by the dashboard's closed list and the seed test instead.
4. **Seeds fail to a null, not an exception.** A missing or malformed bundled asset returns null so
   the caller can fall back. This is the surface where a crash costs a subscription, and the SDK has
   been bitten once already by a bundled-asset path throwing from a static initializer.

> **The device-only regex bug, kept as a warning.** `PaywallVariables`' pattern escapes both braces
> on **both** sides. The JVM's `java.util.regex` accepts a bare `}` as a literal, so the unescaped
> form compiled and **416 JVM tests passed**; Android's stricter engine threw `PatternSyntaxException`
> from a **static initializer**, i.e. `ExceptionInInitializerError` the first time any paywall
> rendered — the app died opening the paywall. Found only on a device. JVM-green is not a paywall
> verdict.

### `RenderContext` — what the tree is rendered against

`RenderContext(locale, hasIntroOffer, selectedPackageRole, availableRoles)`.

`availableRoles` filters the tree's package roles down to the ones this tenant's catalogue can
actually price — a tree may author more plans than a given tenant sells, and the unsold ones should
not sit inert on the paywall. **It is never allowed to be empty**: an empty filter hides every plan,
which leaves a headline, a CTA and nothing to buy. If nothing resolves, showing the authored plans
beats showing none — worst case a price is missing, versus no way to subscribe at all. (A genuinely
empty catalogue is a separate, earlier branch.)

The tree's authored default selection (`Package.isSelectedByDefault`) is applied **once**, through
the same `SelectPlan` action the user's taps use — never by styling the card — so what is *ringed*
and what `Continue` *buys* can never disagree. It is read from the **effective** workflow, not the
tenant's tree alone: reading `treeWorkflow` only was written before seeds became the render path, and
on a real app with no published tree (cappy) it silently did nothing.

**Theme + copy from cloud** — `effectiveThemeOverride` merges `themeJsonb` with the dedicated
`primaryColor` column, and `primary_color` is authoritative. The dashboard's Paywall designer writes
the brand colour into its own column, **not** into `theme_jsonb`; without the merge the brand colour
silently drops and the paywall inherits the host app's MaterialTheme primary.

Also cloud-driven: `heroTitle`, `heroSubtitle`, `valueProps[]`, `ctaContinue`, `ctaGetPremium`,
`restoreLabel`, `termsUrl`, `privacyUrl`, `popularPlanSku`, `successTitle`/`successMessage`/
`successCtaLabel`, `heroIconSvg`, `supportEmail`, `branding`, `customFooter`, and the
**trial-disclosure** trio `trialTermsTemplate` / `trialDisclosureTitle` / `trialDisclosureBody`
(Play Subscriptions policy requires the paywall to state trial length, post-trial price + cadence,
and how to cancel; `{days}` and `{price}` are substituted at render, and a blank value falls back to
the SDK's localized default so an old tenant row stays compliant).

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
the default is `FullScreen` so a tree rendered standalone (previews, screenshot tests) keeps its
self-painting behaviour.

**Rules for anyone authoring a tree or embedding a surface:**

1. Never write a bare `fillMaxSize().background(x)` at a paywall root — use `Modifier.paywallRoot(x)`.
2. Never write a bare `fillMaxSize()` on an inner scroll column — use `Modifier.paywallContentSize()`;
   a full-height scroll column forces the sheet open just as a painted root does.
3. Never nest a PayCraft sheet composable inside another modal sheet.
4. A host that supplies its own container must provide `LocalPayCraftSurfaceMode = Sheet`.

**Verification (device-truth):** a sheet paywall is correct when a fresh capture, taken after
`am force-stop`, shows host content visible above the sheet with the scrim between them. A
screenshot showing an opaque full-window paywall is a failure even if the composable tree compiles.

### Config-resilience surfaces

`ConfigUnavailable(...)`, `PlansUnavailable(onDismiss)` and `StaleConfigNotice(ageSeconds, onRetry)`
render the `ConfigResult` arms (PUBLIC_API.md). Use them rather than an indefinite spinner: the whole
point of `configResultFlow` is that "loading", "offline", and "this is last week's cache" are
different things to say to a buyer, and only one of them deserves a retry button.

---

## The settings section — `PayCraftPlanSection`

Not a paywall, but the same contract: the SDK draws it, the dashboard words it, the host themes it.
Status line, Manage row, Restore row, resolved from live entitlement.

```kotlin
PayCraftPlanSection(
    style = PayCraftPlanSectionStyle.Rows,              // Minimal · Rows · Card · Hero · Compact
    theme = PayCraftPlanSectionTheme.defaults(),            // reads the ambient MaterialTheme
    header = { Text("Subscription") },
)
```

Four public types and nothing else: the composable, `PayCraftPlanSectionStyle`,
`PayCraftPlanSectionTheme`, and the header slot. There is no copy parameter, no repository parameter
and no `onUpgrade` callback — the wording comes from the dashboard, the data from
`PayCraftRepository`, and both actions resolve internally.

**Theme defaults read the ambient `MaterialTheme`**, so an app that themes itself at all already
gets its palette, shape and type here with no argument. Override only where your design system
exposes something Material does not (a spacing scale, an icon-tile colour). `rowMinHeight` defaults
to 48dp and should not go lower: it is the row a user taps in order to CANCEL.

### Settings copy — `settings_*` (migration 156)

14 dashboard fields, edited under **Paywall designer → In-app subscription settings**: the three
tier names, the supporting lines, the trial countdown, the renewal/expiry lines, and the three row
labels.

| Field | Token | Note |
|---|---|---|
| `settings_trial_days_left` | `{days}` | `settings_trial_one_day_left` is SEPARATE — no token can pluralise, so one template would read "1 days left" on the last day |
| `settings_renews_on` / `settings_expires_on` | `{date}` | Keep them distinct. A subscriber who cancelled but is still inside their paid period sees the second; telling them their subscription "renews" is the wording error that generates support mail |
| `settings_trial_ending_today` | — | Not `{days}`=0, which reads as already-expired |

**Blank means "not configured", never "render nothing".** These columns default to `''` rather than
to English — unlike the 071/077 copy columns — because the SDK reads tenant copy as
`.ifBlank { stringResource(…) }`. A column pre-filled with English makes that fallback dead for
every row, silently overriding a localised bundled string for a tenant who never opened the
designer.

For the same reason the settings labels do NOT fall through to their paywall equivalents:
`PaywallDto.restoreLabel` and `ctaGetPremium` default to non-blank English and the server always
sends them, so a middle rung would have made the localised rung unreachable.

---

## Path B — generated bespoke UI against the headless surface

The app owns every pixel and consumes only `PayCraftRepository`. Nothing from
`com.mobilebytelabs.paycraft.ui` or `.presentation` is imported.

(This said `BillingManager` until that type went `internal`. The facade covers every arm a bespoke
paywall renders, including the device-conflict actions, which is what made the narrowing safe.)

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
| B10 | Trial disclosure states length, post-trial price + cadence, and how to cancel | Play Subscriptions policy — the bundled path gets this from `PaywallDto`; a bespoke one must render it itself |

**Prices.** Prefer the native display price (`NativeBillingClient.nativeDisplayPrice`) on Android/iOS
so the buyer sees exactly what the store will charge; fall back to `ProductDto.resolvedPrice`, then to
`basePriceCents`/`baseCurrency`.

---

## Choosing a path

Cloud-rendered is the default: it is dashboard-updatable without an app release and already satisfies
B1–B10. Choose bespoke when the paywall must match a bespoke design system — noting that the
component tree has absorbed much of what used to force that choice, since a tenant can now move,
restyle and re-order the Free arm without an app update. `/idea-paycraft` detects which path an app is
on by whether it imports `com.mobilebytelabs.paycraft.ui`, and verifies that path's assertions only —
per-path, never cross-inherited.
