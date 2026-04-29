---
sidebar_position: 4
---

# Web (WasmJs / Kotlin/JS)

## Dependencies

```kotlin
// build.gradle.kts
implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
```

## Initialization

```kotlin
fun main() {
    PayCraft.configure {
        supabase(url = "https://xxx.supabase.co", anonKey = "eyJ...")
        provider(StripeProvider(paymentLinks = mapOf(
            "monthly" to "https://buy.stripe.com/...",
        )))
        plans(BillingPlan(id = "monthly", name = "Monthly", price = "$4.99/mo"))
        supportEmail("support@yourapp.com")
    }

    ComposeViewport(document.body!!) {
        App()
    }
}
```

## Notes

- Checkout opens via `window.open(url)` or `window.location.href = url`
- Device tokens stored in `localStorage`
- Settings stored in `localStorage` (consider security implications for shared computers)
