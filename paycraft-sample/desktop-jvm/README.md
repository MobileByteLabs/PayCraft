# PayCraft — Desktop JVM Example

Minimal Compose Desktop app demonstrating PayCraft integration.

## Setup

1. Add the dependency to your `build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
}
```

2. Copy `Main.kt` into your project.
3. Replace the Supabase URL, anon key, and Stripe payment links with your own.
4. Run `./gradlew run`.

## What This Shows

- **Configure**: `PayCraft.configure {}` before `application {}` block
- **Paywall**: `PayCraftPaywall()` composable for non-premium users
- **Premium gating**: `billingManager.isPremium` flow
- **Restore**: Force refresh from server
- **Checkout**: Opens in system browser via `Desktop.browse()`
- **Storage**: Device tokens stored in Java Preferences API (`~/.java/.userPrefs/`)
