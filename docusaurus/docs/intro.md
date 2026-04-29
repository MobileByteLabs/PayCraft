---
sidebar_position: 1
slug: /
---

# PayCraft

**Craft your own billing. Any provider. Any platform. 15 minutes.**

Self-hosted, provider-agnostic billing library for Kotlin Multiplatform apps. Uses **Supabase** as the source of truth -- your app never talks to a payment provider directly.

```
Client App --> PayCraft SDK --> Supabase (source of truth)
                                  ^
Payment Provider --webhook--------+
```

## Why PayCraft?

- **Multi-provider**: Not locked to Stripe. Supports Stripe, Razorpay, and custom providers.
- **KMP native**: Works on Android, iOS, Desktop (JVM), Web (WasmJs), macOS.
- **Self-hosted**: Your Supabase, your data. No platform fee.
- **Device binding**: Built-in device registration and conflict resolution.
- **Smart sync**: Tiered cache policy -- won't hit the server on every launch.

## Installation

```kotlin
// build.gradle.kts
implementation("io.github.mobilebytelabs:cmp-paycraft:1.4.0")
```

## Quick Setup

```kotlin
PayCraft.configure {
    supabase(url = "https://xxx.supabase.co", anonKey = "eyJ...")
    provider(StripeProvider(paymentLinks = mapOf(
        "monthly" to "https://buy.stripe.com/...",
        "yearly"  to "https://buy.stripe.com/...",
    )))
    plans(
        BillingPlan(id = "monthly", name = "Monthly", price = "$4.99/mo"),
        BillingPlan(id = "yearly", name = "Yearly", price = "$39.99/yr"),
    )
    supportEmail("support@yourapp.com")
}
```

Then show the paywall:

```kotlin
PayCraftPaywall(onDismiss = { navController.popBackStack() })
```

See the [Quick Start guide](/docs/quick-start) for the full walkthrough.
