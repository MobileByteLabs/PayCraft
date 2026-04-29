---
sidebar_position: 3
---

# Architecture

## Provider-Agnostic Design

The core design principle of PayCraft: **the app never talks to the payment provider directly**.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT APP                                  │
│                                                                      │
│  PayCraft.configure(provider = StripeProvider(...))                  │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐    │
│  │ PayCraftPaywall │  │ PayCraftRestore │  │ PayCraftBanner   │    │
│  └────────┬────────┘  └────────┬────────┘  └────────┬─────────┘    │
│           └───────────────────┬┘                    │               │
│                               ▼                     │               │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │                  BillingManager (Interface)                 │     │
│  │  isPremium: StateFlow<Boolean>                              │     │
│  │  subscriptionStatus: StateFlow<SubscriptionStatus>         │     │
│  │  logIn(email) · logOut() · refreshStatus()                 │     │
│  └──────────────────────────┬─────────────────────────────────┘     │
│                             │                                         │
│  ┌──────────────────────────▼─────────────────────────────────┐     │
│  │             PayCraftBillingManager (Implementation)          │     │
│  │  Queries Supabase · Caches email · Manages state            │     │
│  └──────────────────────────┬─────────────────────────────────┘     │
│                             │                                         │
└─────────────────────────────┼───────────────────────────────────────┘
                              │ Supabase RPC calls
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     SUPABASE (Source of Truth)                       │
│                                                                      │
│  ┌──────────────────────┐   ┌──────────────────────────────────┐   │
│  │  subscriptions table  │   │  is_premium(email) → boolean     │   │
│  │  email  provider  plan│   │  get_subscription(email) → row   │   │
│  │  status  period_end   │   └──────────────────────────────────┘   │
│  └──────────────────────┘                                            │
│            ▲                                                          │
│            │ upsert via webhook                                       │
│  ┌─────────┴──────────────────────────────────────────────────┐     │
│  │              Webhook Edge Functions                          │     │
│  │  ┌─────────────────┐   ┌──────────────────────────────┐   │     │
│  │  │  stripe-webhook  │   │  razorpay-webhook             │   │     │
│  │  │  (Deno/TS)       │   │  (Deno/TS)                   │   │     │
│  │  └────────┬─────────┘   └────────────┬─────────────────┘   │     │
│  │           └────────────────┬──────────┘                      │     │
│  │                            ▼                                  │     │
│  │          subscription-handler.ts (shared upsert logic)        │     │
│  └───────────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────────┘
                    ▲                           ▲
                    │ webhook                   │ webhook
         ┌──────────┴─────────┐     ┌──────────┴──────────┐
         │   Stripe           │     │   Razorpay           │
         │   (payment events) │     │   (payment events)   │
         └────────────────────┘     └─────────────────────┘
```

## Key Insight

The payment provider (Stripe, Razorpay, etc.) is only used for:
1. **Getting the checkout URL** — where to send the user to pay
2. **Getting the management URL** — where the user can cancel/update

Everything else — subscription status, premium checks, caching — goes through Supabase.

**This means**:
- Switching providers = updating `PayCraft.configure()`, no client code changes
- Provider outage ≠ app outage (status cached in Supabase)
- Multi-provider support is trivial (two webhooks, same table)

## Component Breakdown

### PayCraft (Singleton)

```kotlin
object PayCraft {
    fun configure(builder: PayCraftConfigBuilder.() -> Unit)
    fun checkout(plan: BillingPlan, email: String? = null)  // opens checkout URL
    fun manageSubscription(email: String)                   // opens management URL
}
```

Holds the configuration. Called once at app startup before Koin.

### BillingManager (Interface)

```kotlin
interface BillingManager {
    val isPremium: StateFlow<Boolean>
    val subscriptionStatus: StateFlow<SubscriptionStatus>
    val billingState: StateFlow<BillingState>
    val userEmail: StateFlow<String?>
    fun logIn(email: String)   // restores purchase
    fun logOut()               // clears state
    fun refreshStatus()        // re-checks Supabase
}
```

The public API your app uses. Injected via Koin.

### PayCraftBillingManager (Implementation)

- On `logIn(email)`: saves email to persistent storage, calls `is_premium(email)` RPC
- On `isPremium = true`: fetches full `SubscriptionStatus` via `get_subscription(email)`
- Emits `BillingState`: `Loading → Free | Premium(status) | Error`
- On app restart: loads saved email, checks status automatically

### PaymentProvider (Interface)

```kotlin
interface PaymentProvider {
    val name: String
    val webhookFunctionName: String
    fun getCheckoutUrl(plan: BillingPlan, email: String? = null): String
    fun getManageUrl(email: String): String?
}
```

Only the two URL-getters. Implemented per-provider.

### Supabase Schema

```sql
CREATE TABLE public.subscriptions (
    id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email                    text NOT NULL,        -- user identifier
    provider                 text NOT NULL,        -- "stripe", "razorpay"
    provider_customer_id     text,
    provider_subscription_id text,
    plan                     text NOT NULL,        -- plan ID from PayCraft.configure()
    status                   text NOT NULL,        -- "active", "canceled", "past_due", "trialing"
    current_period_start     timestamptz,
    current_period_end       timestamptz,
    cancel_at_period_end     boolean DEFAULT false,
    created_at               timestamptz DEFAULT now(),
    updated_at               timestamptz DEFAULT now()
);
```

One row per user. Email is the unique identifier (no Supabase Auth required).

### is_premium() Logic

```sql
CREATE OR REPLACE FUNCTION is_premium(user_email text)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE email = lower(user_email)
        AND status IN ('active', 'trialing')
        AND current_period_end > now()
    );
END;
$$ LANGUAGE plpgsql;
```

Simple, fast, cacheable. No JWTs, no user sessions required.

## Security Model

See [SECURITY.md](SECURITY.md) for details on:
- Webhook signature verification (Stripe HMAC-SHA256, Razorpay HMAC-SHA256)
- RLS policies (public read, service_role write)
- Key management (never hardcode, use secrets manager)
- Anon key safety (is_premium is public read — cannot be abused)
