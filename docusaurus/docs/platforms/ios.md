---
sidebar_position: 2
---

# iOS (SwiftUI)

## Dependencies

Add to your KMP shared module's `build.gradle.kts`:

```kotlin
implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
```

## Initialization

In your shared KMP module's iOS entry point:

```kotlin
// shared/src/iosMain/kotlin/AppInit.kt
fun initPayCraft() {
    PayCraft.configure {
        supabase(url = "https://xxx.supabase.co", anonKey = "eyJ...")
        provider(StripeProvider(paymentLinks = mapOf(
            "monthly" to "https://buy.stripe.com/...",
        )))
        plans(BillingPlan(id = "monthly", name = "Monthly", price = "$4.99/mo"))
        supportEmail("support@yourapp.com")
    }
}
```

## SwiftUI Wrapper

```swift
import SwiftUI
import shared  // Your KMP shared module

struct PaywallView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        // Use ComposeUIViewController from your shared module
        MainViewControllerKt.PaywallViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
```

## Notes

- Device tokens are stored in NSUserDefaults (encrypted at rest via iOS Data Protection)
- Checkout opens in the system browser via `UIApplication.shared.open(url)`
