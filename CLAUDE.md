# PayCraft — Claude Instructions

> Self-hosted, multi-provider billing library for KMP apps.
> "Craft your own billing. Any provider. Any platform. 15 minutes."

## Architecture

```
Client App → PayCraft library → Supabase (source of truth)
Payment Provider (Stripe/Razorpay) → Webhook → Supabase
```

The app NEVER talks to the payment provider directly. It only queries Supabase.
Webhooks keep Supabase in sync with the payment provider.

## Key Files

| File | Purpose |
|------|---------|
| `cmp-paycraft/` | KMP library module |
| `PayCraft.kt` | Singleton config — entry point |
| `core/BillingManager.kt` | Interface — isPremium, logIn, logOut, refreshStatus(force) |
| `core/PayCraftBillingManager.kt` | Implementation — cache-first init + smart sync |
| `core/SyncPolicy.kt` | Tiered sync intervals (weekly/daily/hourly) |
| `provider/PaymentProvider.kt` | Provider interface (Stripe, Razorpay, Custom) |
| `network/PayCraftService.kt` | Supabase RPC calls |
| `persistence/PayCraftStore.kt` | Email + subscription cache interface |
| `persistence/PayCraftSettingsStore.kt` | multiplatform-settings cache implementation |
| `platform/TimeProvider.kt` | expect/actual currentTimeMillis() (6 platforms) |
| `ui/PayCraftPaywall.kt` | Default paywall UI |
| `di/PayCraftModule.kt` | Koin DI module |
| `server/migrations/` | SQL for subscriptions table + RPCs |
| `server/functions/` | Webhook Edge Functions per provider |

## Commands

| Command | Purpose |
|---------|---------|
| `/paycraft-adopt` | **E2E adoption: env + Supabase + provider + client + verify (START HERE)** |
| `/paycraft-adopt-env` | Phase 1: env bootstrap + key validation only |
| `/paycraft-adopt-supabase` | Phase 2: Supabase migrations + webhook only |
| `/paycraft-adopt-stripe` | Phase 3: Stripe test setup only |
| `/paycraft-adopt-razorpay` | Phase 3B: Razorpay setup only |
| `/paycraft-adopt-client` | Phase 4: client app integration only |
| `/paycraft-adopt-verify` | Phase 5: end-to-end verification only |
| `/setup` | Legacy full setup (Supabase + provider) |
| `/setup-stripe` | Create Stripe products, prices, payment links |
| `/setup-razorpay` | Create Razorpay subscription plans |
| `/setup-supabase` | Create table, RPCs, deploy webhook |
| `/add-provider` | Add a new payment provider implementation |
| `/add-plan` | Add a new subscription plan |
| `/verify` | Test entire setup end-to-end |

## Provider Design

All providers implement `PaymentProvider` interface:
- `StripeProvider` — uses Stripe Payment Links
- `RazorpayProvider` — uses Razorpay Payment Links
- `CustomProvider` — bring your own checkout URLs

To add a new provider:
1. Implement `PaymentProvider` interface
2. Create webhook Edge Function in `server/functions/{name}-webhook/`
3. Use shared `handleSubscriptionEvent()` from `_shared/subscription-handler.ts`

## Client App Integration

Client apps add PayCraft with:
```kotlin
implementation("io.github.mobilebytelabs:paycraft:VERSION")
```

Then configure:
```kotlin
PayCraft.configure {
    supabase(url = "...", anonKey = "...")
    provider(StripeProvider(paymentLinks = mapOf(...)))
    plans(BillingPlan(...), BillingPlan(...))
    benefits(BillingBenefit(...))
    supportEmail("...")
}
```

All keys are provided by the client app — nothing hardcoded in the library.
