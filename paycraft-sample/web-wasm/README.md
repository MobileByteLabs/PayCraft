# PayCraft — Web (WasmJs) Example

Minimal Kotlin/Wasm browser app demonstrating PayCraft integration.

## Setup

1. Add the dependency to your `build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
}
```

2. Copy `Main.kt` into your project.
3. Replace the Supabase URL, anon key, and Stripe payment links with your own.
4. Run `./gradlew wasmJsBrowserRun`.

## What This Shows

- **Configure**: `PayCraft.configure {}` before `ComposeViewport` block
- **Paywall**: `PayCraftPaywall()` composable for non-premium users
- **Premium gating**: `billingManager.isPremium` flow
- **Restore**: Force refresh from server
- **Checkout**: Opens via `window.open()` or `window.location.href`
- **Storage**: Device tokens stored in `localStorage`
