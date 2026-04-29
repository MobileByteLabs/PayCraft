---
sidebar_position: 3
---

# Desktop (JVM / Compose Desktop)

## Dependencies

```kotlin
// build.gradle.kts
implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
```

## Initialization

```kotlin
fun main() = application {
    PayCraft.configure {
        supabase(url = "https://xxx.supabase.co", anonKey = "eyJ...")
        provider(StripeProvider(paymentLinks = mapOf(
            "monthly" to "https://buy.stripe.com/...",
        )))
        plans(BillingPlan(id = "monthly", name = "Monthly", price = "$4.99/mo"))
        supportEmail("support@yourapp.com")
    }

    Window(onCloseRequest = ::exitApplication) {
        App()
    }
}
```

## Notes

- Checkout opens in the default system browser via `Desktop.browse(URI(url))`
- Device tokens stored in Java Preferences API
- Settings stored in platform-default location (`~/.java/.userPrefs/`)
