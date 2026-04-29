---
sidebar_position: 1
---

# Provider-Agnostic Model

PayCraft's core principle: **your app never talks to the payment provider directly**.

## How It Works

```
Your App --> PayCraft SDK --> Supabase (queries subscription status)
                                ^
Stripe/Razorpay --webhook------+  (keeps Supabase in sync)
```

The app only knows about `isPremium`, `plan`, and `expiresAt`. It never sees Stripe customer IDs, webhook payloads, or provider-specific data.

## Why This Matters

- **Switch providers** without changing app code -- just deploy a new webhook
- **Support multiple providers** in the same table (each row has a `provider` column)
- **No SDK lock-in** -- PayCraft wraps the provider, not the other way around

## Provider Interface

All providers implement the same interface:

```kotlin
interface PaymentProvider {
    val name: String
    fun getCheckoutUrl(planId: String, email: String): String
    fun getManageSubscriptionUrl(): String?
}
```

Built-in: `StripeProvider`, `RazorpayProvider`, `CustomProvider`.
