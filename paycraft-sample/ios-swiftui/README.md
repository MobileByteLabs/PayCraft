# PayCraft — iOS SwiftUI Example

Minimal iOS app demonstrating PayCraft integration via KMP shared module and SwiftUI wrapper.

## Setup

1. Add the dependency to your KMP shared module's `build.gradle.kts`:

```kotlin
dependencies {
    implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
}
```

2. Copy `AppInit.kt` into your shared module's `iosMain` source set.
3. Copy `PaywallView.swift` and `ContentView.swift` into your iOS app.
4. Replace the Supabase URL, anon key, and Stripe payment links with your own.
5. Call `AppInitKt.initPayCraft()` from your SwiftUI `App.init()`.

## What This Shows

- **Configure**: `PayCraft.configure {}` in shared KMP module
- **SwiftUI wrapper**: `UIViewControllerRepresentable` bridging Compose to SwiftUI
- **Premium gating**: Check premium status from shared module
- **Restore**: Force refresh from server
