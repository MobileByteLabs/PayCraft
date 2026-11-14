# /paycraft-setup — Integrate PayCraft Into This Project

Fully automates adding PayCraft billing to this KMP app.

## What This Does

1. Adds PayCraft dependency to gradle files
2. Provisions the publishable keys + a release-build guard
3. Wires `payCraft(...)` into the shared Koin module
4. Adds `PayCraftSheet` + `PayCraftRestore` to SettingsScreen
5. Replaces inline premium checks with `PayCraftRepository.entitlement` (the SDK is the SoT; no app-authored wrapper)
6. Builds and verifies

## Steps

### Step 1: Add Dependency

Find `gradle/libs.versions.toml` and add:

```toml
[versions]
paycraft = "1.0.0"

[libraries]
paycraft = { module = "io.github.mobilebytelabs:cmp-paycraft", version.ref = "paycraft" }
```

Find the shared/common module's `build.gradle.kts` and add:
```kotlin
commonMain.dependencies {
    implementation(libs.paycraft)
}
```

### Step 2: Provision the publishable keys

PayCraft needs ONE publishable key per app (`pk_…`, from the PayCraft dashboard), optionally a
second test key. Do NOT use the Supabase URL or anon key — the SDK carries its own backend
constants, and an anon JWT passed as `apiKey` is not a PayCraft key.

Expose them as build-config fields fed from the project's secrets path (never hardcode in source):
`PAYCRAFT_API_KEY_LIVE` (release) and `PAYCRAFT_API_KEY_TEST` (debug).

**Release guard (required):** fail the release build when the live key is blank or not `pk_…`.
Debug builds run on the test key, so a missing live key is invisible until the release reaches
users — the SDK no longer crashes on it, but it boots UNCONFIGURED and sells nothing:

```kotlin
// in the module that declares the build-config fields
val liveKey = /* the value you feed PAYCRAFT_API_KEY_LIVE */
tasks.matching { it.name.contains("Release") && (it.name.startsWith("assemble") || it.name.startsWith("bundle")) }
    .configureEach {
        doFirst {
            check(liveKey.startsWith("pk_")) { "PAYCRAFT_API_KEY_LIVE is missing or not a pk_ key — release would ship billing unconfigured" }
        }
    }
```

### Step 3: Wire `payCraft(...)` into Koin

In the shared network/DI module (commonMain, NOT a per-platform Application class):

```kotlin
val ProjectNetworkModule = module {
    includes(
        payCraft(
            apiKey = BuildKonfig.PAYCRAFT_API_KEY_LIVE,
            testApiKey = BuildKonfig.PAYCRAFT_API_KEY_TEST,
            identity = { get<AuthRepository>().session.map { it.user?.email } }, // omit if no accounts
        ),
    )
}
```

That is the whole integration: `payCraft(...)` includes `PayCraftModule`, initializes the SDK before
anything resolves, and keeps identity bound. Products, providers, plans, prices and paywall styling
come from the dashboard. (`PayCraft.configure { … }` was removed in v2.0.)

### Step 4: Add PayCraft UI to SettingsScreen

Find `SettingsScreen.kt` or equivalent. Add:

```kotlin
// State
var showPaywall by remember { mutableStateOf(false) }
var showRestore by remember { mutableStateOf(false) }

// In the screen content:
PayCraftBanner(
    onClick = { showPaywall = true },
    onRestoreClick = { showRestore = true },
)

// Outside the content (overlays):
if (showPaywall) {
    PayCraftSheet(
        visible = showPaywall,
        onDismiss = { showPaywall = false },
    )
}

if (showRestore) {
    PayCraftRestore(
        visible = showRestore,
        onDismiss = { showRestore = false },
    )
}
```

Imports:
```kotlin
import com.mobilebytelabs.paycraft.ui.PayCraftBanner
import com.mobilebytelabs.paycraft.ui.PayCraftSheet
import com.mobilebytelabs.paycraft.ui.PayCraftRestore
```

### Step 5: Replace Existing Premium Checks

Search for existing premium checks (`isPremium`, `isSubscribed`, `hasPremium`, `SubscriptionManager`).

For each file found, replace with:

```kotlin
// Inject THE ONE surface. No app-authored repository, api or store wrapper
// (RULE-PAYCRAFT-SINGLE-SURFACE-001) — the SDK is the source of truth for these types.
val paycraft: PayCraftRepository = koinInject()        // or `by inject()` outside Compose

// Gate on the ENTITLEMENT summary
val entitlement by paycraft.entitlement.collectAsState()
if (entitlement.isPremium) { PremiumContent() } else { FreeContent() }

// Shorthand when you only need the boolean
val isPremium by paycraft.isPremium.collectAsState()
```

**Gate on `entitlement`, not `billingState`.** `billingState` says where a PURCHASE is — seven
variants, six of which mean "not right now, for process reasons". `entitlement` folds
`Loading`/`Error`/`PaymentPending` so they PRESERVE the previous tier: a payment settling
asynchronously must never show the paywall to someone who already paid
(`BILLING_STATE_SEMANTICS.md`).

`EntitlementSummary` carries `tier` (`FREE`/`TRIAL`/`PREMIUM`), `isPremium` (true during a trial
too), `isInTrial`, `planSku`, `trialEndsAt`, and `roleIdentifier` — the tenant-configured package
role, which is how an app with several paid tiers asks "is this the top tier?" without hardcoding a
product name. A dashboard rename of the role then reaches the app with no release.

Remove any existing:
- `SupabaseSubscriptionService` or similar
- `SubscriptionManager` (old interface)
- Inline Supabase subscription queries
- **an app-authored `*Api` / `*Repository` / `*Store` wrapping the SDK, and any local entitlement or
  plan model** — measured on `mbs/cappy`: 670 LOC across five modules, ~95% type translation. Use
  `PayCraftRepository` + `EntitlementSummary` + `BillingPlan` directly. For unit tests the SDK ships
  `FakePayCraftRepository` in its MAIN artifact, so dropping the wrapper costs no testability.
- a local plan catalogue — plans come from `paycraft.plans` (tenant config)

### Step 6: Build Verification

Note any compilation errors. Common fixes:
- Add import: `import com.mobilebytelabs.paycraft.ui.PayCraftBanner`
- Add import: `import com.mobilebytelabs.paycraft.repository.PayCraftRepository`
- Add import: `import com.mobilebytelabs.paycraft.model.EntitlementTier`  (only if you switch on tier)
- Add import: `import org.koin.compose.koinInject`

Report: "PayCraft integration complete. Run the app to test the paywall."
