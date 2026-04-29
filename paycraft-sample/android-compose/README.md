# PayCraft — Android Compose Example

Minimal Android app demonstrating PayCraft integration with Jetpack Compose and Koin.

## Setup

1. Add the dependency to your `app/build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
}
```

2. Copy `MyApp.kt` and `PremiumScreen.kt` into your project.
3. Replace the Supabase URL, anon key, and Stripe payment links with your own.
4. Run `./gradlew installDebug`.

## What This Shows

- **Configure**: `PayCraft.configure {}` in `Application.onCreate()`
- **Paywall**: `PayCraftPaywall()` composable for non-premium users
- **Premium gating**: `billingManager.isPremium` flow
- **Restore**: `billingManager.refreshStatus(force = true)` to re-check server
- **Encrypted storage**: Optional AES-256 encrypted local cache via `PayCraftPlatform.encryptedSettings()`
