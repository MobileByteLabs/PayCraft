# /paycraft-setup — Integrate PayCraft Into This Project

Fully automates adding PayCraft billing to this KMP app.

## What This Does

1. Adds PayCraft dependency to gradle files
2. Reads existing Supabase config from BuildConfig/env
3. Asks for payment links, plans, benefits
4. Generates `PayCraft.configure()` in app initialization
5. Adds `PayCraftModule` to Koin modules
6. Adds `PayCraftSheet` + `PayCraftRestore` to SettingsScreen
7. Replaces inline premium checks with `PayCraftRepository.entitlement` (the SDK is the SoT; no app-authored wrapper)
8. Builds and verifies

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

### Step 2: Read Existing Supabase Config

Search for `SUPABASE_URL`, `supabaseUrl`, or similar in:
- `BuildConfig` classes
- `local.properties`
- `config/` directory
- App module's constants

Extract the Supabase URL and anon key values.

### Step 3: Gather Configuration

Ask the user:
1. Payment provider: stripe or razorpay?
2. Payment link URLs for each plan (monthly/quarterly/yearly)
3. Customer portal URL (Stripe) or dashboard URL (Razorpay)
4. Plan names and prices (for display)
5. App benefits to show in paywall (3-5 benefits with icons from `Icons.Default.*`)
6. Support email

### Step 4: Generate PayCraft.configure()

Find the app initialization file (Application.kt, App.kt, or main entry point).

Add/update PayCraft configuration:

```kotlin
PayCraft.configure {
    supabase(
        url = BuildConfig.SUPABASE_URL,         // use existing constant
        anonKey = BuildConfig.SUPABASE_ANON_KEY, // use existing constant
    )
    provider(
        StripeProvider(  // or RazorpayProvider
            paymentLinks = mapOf(
                "monthly"   to "[MONTHLY_URL]",
                "quarterly" to "[QUARTERLY_URL]",
                "yearly"    to "[YEARLY_URL]",
            ),
            customerPortalUrl = "[PORTAL_URL]",
        )
    )
    plans(
        BillingPlan(id = "monthly",   name = "Monthly",   price = "[PRICE]", interval = "/month",  rank = 1),
        BillingPlan(id = "quarterly", name = "Quarterly", price = "[PRICE]", interval = "/3 months", rank = 2),
        BillingPlan(id = "yearly",    name = "Yearly",    price = "[PRICE]", interval = "/year",   rank = 3, isPopular = true),
    )
    benefits(
        BillingBenefit(icon = Icons.Default.[Icon], text = "[benefit text]"),
        // ... more benefits
    )
    supportEmail("[SUPPORT_EMAIL]")
}
```

Call `PayCraft.configure {}` BEFORE Koin initialization.

### Step 5: Add PayCraftModule to Koin

Find where `startKoin {}` or `KoinApplication` is configured.

Add `PayCraftModule` to the modules list:

```kotlin
startKoin {
    modules(
        existingModule1,
        existingModule2,
        PayCraftModule,  // ← add this
    )
}
```

### Step 6: Add PayCraft UI to SettingsScreen

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

### Step 7: Replace Existing Premium Checks

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

### Step 8: Build Verification

Note any compilation errors. Common fixes:
- Add import: `import com.mobilebytelabs.paycraft.ui.PayCraftBanner`
- Add import: `import com.mobilebytelabs.paycraft.repository.PayCraftRepository`
- Add import: `import com.mobilebytelabs.paycraft.model.EntitlementTier`  (only if you switch on tier)
- Add import: `import org.koin.compose.koinInject`

Report: "PayCraft integration complete. Run the app to test the paywall."
