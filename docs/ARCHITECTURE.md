# PayCraft Architecture

## Provider-Agnostic Design

The core design principle of PayCraft: **the app never talks to the payment provider directly**.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT APP                                  │
│                                                                      │
│  PayCraft.configure(provider = StripeProvider(...))                  │
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐    │
│  │ PayCraftPaywall │  │ PayCraftRestore │  │ PayCraftPlanBanner   │    │
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
    trial_start              timestamptz,          -- v1.1 (migration 026) — NULL when no trial
    trial_end                timestamptz,          -- v1.1 (migration 026) — NULL when no trial
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

The `status IN ('active', 'trialing')` clause is intentional and was already
correct pre-v1.1 — trialing subscriptions ARE premium. `current_period_end`
during a trial equals `trial_end`, so the time gate also holds. No change was
needed to this RPC when trial support landed.

## Trials (since v1.1)

Trial-product support follows the same architectural principle as the rest of
PayCraft: **the app never talks to the provider directly**. Trials are
configured at the provider (Stripe Price `trial_period_days`, Razorpay
subscription `start_at`) and surfaced to the client via the same webhook →
Supabase → RPC chain.

### Three pieces

1. **Configuration (one-time, per Price/Plan)** — set during adoption:
   - Stripe: `mcp__stripe__create_price` with `recurring.trial_period_days`
     (see `paycraft-adopt-stripe.md` step 3A.3).
   - Razorpay: per-subscription `start_at` at checkout time
     (see `paycraft-adopt-razorpay.md` step 3B.2).

2. **Webhook mapping** — `server/functions/_shared/subscription-handler.ts`
   accepts `trialStart` / `trialEnd` on every `SubscriptionEvent`. The Stripe
   webhook (`server/functions/stripe-webhook/index.ts`) extracts
   `sub.trial_start` and `sub.trial_end` from `customer.subscription.created`
   and `customer.subscription.updated` events. Result: `subscriptions.trial_end`
   is populated.

3. **Client surfacing** — `PayCraftService.getSubscription` returns the trial
   columns (migration 026 extended the RPC's status filter to include
   `'trialing'`). `PayCraftBillingManager.applyPremiumResult` builds a
   `TrialInfo(endsAt, daysRemaining)` via the pure `computeTrialInfo()` helper
   and emits it inside `BillingState.Premium.trial`. Two parallel `StateFlow`s
   on `BillingManager` (`isInTrial`, `trialEndsAt`) provide direct binding
   targets for consumer UIs that don't want to `when` on the sealed state.

### Eligibility (`is_trial_eligible`)

A second trial is impossible. `is_trial_eligible(server_token)` returns
`NOT EXISTS (SELECT 1 FROM subscriptions WHERE email = $1 AND trial_end IS NOT NULL)`
— if the user has ever had a trial recorded, they're disqualified server-side.
The paywall (via `BillingManager.checkTrialEligibility()`) suppresses the trial
CTA accordingly. Race window between trial start and webhook arrival is
~seconds; Stripe's own duplicate-subscription detection catches collisions at
the price level.

**Resub protection (migration 027):** `is_trial_eligible` depends on
`trial_end` persisting permanently. A naïve UPSERT on the email key would
clobber the historical `trial_end` when a user cancels and resubscribes with a
new `provider_subscription_id` — re-opening eligibility. The
`subscriptions_preserve_trial_fields_trigger` (BEFORE UPDATE) treats trial
fields as sticky: any UPDATE that tries to clear them (NEW=NULL ∧ OLD≠NULL)
falls back to the historical value. Legitimate Stripe trial extensions (NEW
non-null) are still honored.

### `BillingPlan.trialDays` is a hint, not a contract

The consumer's `BillingPlan(trialDays = 7)` drives the paywall **display**
(the "Start 7-day free trial" chip and CTA) but does NOT enforce the trial
period. Stripe's `trial_period_days` on the Price is authoritative — if the
two diverge, the paywall says one thing and Stripe bills another. Keep them
aligned by always reconfiguring through `/paycraft-adopt-stripe`, which
writes both the Stripe Price config and the `PAYCRAFT_PLAN_[i]_TRIAL_DAYS`
.env entry consumed by the consumer's `BillingPlan` declaration.

### Razorpay status

The Razorpay webhook handler (`server/functions/razorpay-webhook/index.ts`)
lives next to Stripe's. It handles `subscription.activated`,
`subscription.charged` (renewal), `subscription.cancelled`,
`subscription.halted` (past_due), and `subscription.completed`. Trial detection
follows Razorpay's "scheduled first invoice" convention: if
`subscription.start_at > subscription.created_at`, the window between them is
the trial — we map `trial_start = created_at`, `trial_end = start_at`.

Email resolution uses `subscription.notes.paycraft_email`, written by the
adopt-flow at subscription creation (consumer apps must include it in the
notes when calling Razorpay's subscription-create API). Without an email, the
shared handler falls back to updating by `provider_subscription_id` only —
fine for renewals/cancellations, but the initial activation won't be a full
upsert.

Dual-mode signature verification mirrors the Stripe pattern: the handler
tries `RAZORPAY_TEST_WEBHOOK_SECRET` first, then `RAZORPAY_LIVE_WEBHOOK_SECRET`,
and refuses any payload that neither verifies. Mode is also opportunistically
read from `subscription.notes.paycraft_mode` to skip a verification roundtrip.

## Security Model

See [SECURITY.md](SECURITY.md) for details on:
- Webhook signature verification (Stripe HMAC-SHA256, Razorpay HMAC-SHA256)
- RLS policies (public read, service_role write)
- Key management (never hardcode, use secrets manager)
- Anon key safety (is_premium is public read — cannot be abused)
