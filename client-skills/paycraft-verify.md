# /paycraft-verify — Verify PayCraft Integration

Verifies that PayCraft is correctly integrated into this KMP app.

## Checks

| # | Check | How |
|:-:|-------|-----|
| 1 | `PayCraft.configure()` called before Koin | Search app init files |
| 2 | `PayCraftModule` in Koin modules | Search startKoin block |
| 3 | `BillingManager` injected at premium gates | Search for isPremium usage |
| 4 | `PayCraftSheet` accessible from settings | Check SettingsScreen |
| 5 | `PayCraftRestore` accessible from settings | Check SettingsScreen |
| 6 | Dependency in `libs.versions.toml` | Check gradle files |
| 7 | No inline subscription code remaining | Search for old code |

## Steps

### Step 1: Check Dependency

Read `gradle/libs.versions.toml`:
- ✅ `paycraft = "1.0.0"` in `[versions]`
- ✅ `paycraft = { module = "io.github.mobilebytelabs:paycraft", ... }` in `[libraries]`

Read the shared module's `build.gradle.kts`:
- ✅ `implementation(libs.paycraft)` in `commonMain.dependencies`

### Step 2: Check PayCraft.configure()

Search for `PayCraft.configure` in the codebase.

- ✅ Found in app initialization (Application.kt or similar)
- ✅ Called before `startKoin`
- ✅ Contains `supabase(url, anonKey)` — not empty strings
- ✅ Contains `provider(...)` with actual payment links (not placeholder URLs)
- ✅ Contains at least one `plans(...)` entry
- ✅ Contains `supportEmail(...)`

### Step 3: Check Koin Module

Search for `PayCraftModule` in the codebase.

- ✅ Found in `startKoin { modules(...) }` block
- ✅ `PayCraftModule` is included alongside other modules

### Step 4: Check BillingManager Usage

Search for `isPremium` in the codebase.

For each file using `isPremium`:
- ✅ Using `BillingManager.isPremium` (PayCraft) — not an old custom implementation
- ✅ Imported from `com.mobilebytelabs.paycraft.core.BillingManager`

### Step 5: Check Settings UI

Read `SettingsScreen.kt` (or equivalent):
- ✅ `PayCraftBanner` present
- ✅ `PayCraftSheet` shown when premium button tapped
- ✅ `PayCraftRestore` shown when restore button tapped

### Step 6: Check for Old Code

Search for old subscription code that should be removed:
- ❌ `SupabaseSubscriptionService` — should be removed
- ❌ Old `SubscriptionManager` interface (not from PayCraft) — should be removed
- ❌ Inline Supabase RPC calls for `is_premium` — should be removed

### Step 7: Report

```
PayCraft Integration Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[✓] Dependency: io.github.mobilebytelabs:paycraft:1.0.0
[✓] PayCraft.configure() called in app init
[✓] PayCraftModule in Koin
[✓] BillingManager used at all premium gates ([N] files)
[✓] PayCraftSheet in SettingsScreen
[✓] PayCraftRestore in SettingsScreen
[✓] No legacy subscription code found

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Integration is correct. Build to verify compilation.
```

If issues found, provide specific fix instructions.
