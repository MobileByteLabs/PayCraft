# PayCraft FAQ

## General

**What's the fee?**

0% platform fee. PayCraft is self-hosted — you only pay your payment provider's fee (Stripe: 2.9% + $0.30, Razorpay: 2% for INR). No additional cut.

**Does PayCraft require Supabase?**

Yes. Supabase is the source of truth for subscription status. The free tier (500MB, 2 projects) is more than sufficient for most apps.

**Can I use multiple payment providers simultaneously?**

One active provider per Supabase project. You can switch providers by updating `PayCraft.configure()` and deploying a new webhook. Historical subscriptions remain in the table regardless of provider.

**Does it work without Supabase Auth?**

Yes. PayCraft uses email as the user identifier, not Supabase Auth tokens. This is intentional — it's simpler and works with any auth system.

**Is PayCraft open source?**

Yes, Apache 2.0. Fork it, modify it, use it commercially.

---

## Billing

**Does PayCraft support free trials?**

Yes. Two layers:

1. **`is_premium()` already accepts `'trialing'`** — a trialing subscription is treated as premium, no client work required for basic gating.

2. **Since v1.1 (migration 026):** the library actively surfaces trial state via `BillingManager.isInTrial`, `trialEndsAt`, and `BillingState.Premium.trial: TrialInfo?`. The paywall shows a "Start N-day free trial" CTA when `BillingPlan(trialDays = N)` is configured and `is_trial_eligible(token)` returns true. Eligibility is server-derived (`subscriptions.trial_end IS NOT NULL`) so a user can't get two trials by reinstalling.

To enable: re-run `/paycraft-adopt-stripe` (it now prompts for `trial_period_days` per plan) and declare `BillingPlan(trialDays = 7)` in your consumer app's `PayCraft.configure { plans(...) }` call. See [ARCHITECTURE.md § Trials](ARCHITECTURE.md#trials-since-v11) for the full data flow.

**Why does the trial CTA still show "Start 7-day free trial" when my Stripe price says 14 days?**

`BillingPlan.trialDays` is a display hint, not a billing contract. Stripe is authoritative at checkout time. The library does not reconcile the two. Keep them aligned by reconfiguring through `/paycraft-adopt-stripe` — it writes both the Stripe Price's `trial_period_days` and the `PAYCRAFT_PLAN_[i]_TRIAL_DAYS` .env entry that your `BillingPlan` declaration reads.

**Can a user start a second trial by reinstalling the app?**

No. Eligibility is server-derived. The `is_trial_eligible(server_token)` RPC checks `NOT EXISTS (SELECT 1 FROM subscriptions WHERE email = $1 AND trial_end IS NOT NULL)`. A single historical trial disqualifies the email permanently. The client-side `BillingManager.checkTrialEligibility()` thin-wraps this call and the paywall suppresses the trial CTA when it returns false.

**How does restore purchase work?**

User enters their email → `BillingManager.logIn(email)` → calls `is_premium(email)` → if true, premium state is restored. No server-side magic needed.

**What happens when a subscription expires?**

When `current_period_end` passes, `is_premium()` returns `false`. The app detects this on next refresh (`refreshStatus()` or app restart).

**What if a payment fails?**

The webhook marks the subscription as `past_due`. PayCraft treats `past_due` as not-premium by default (only `active` and `trialing` count). You can customize this behavior.

**Can I grant lifetime access?**

Yes — insert a row manually with `status = 'active'` and `current_period_end = '2099-01-01'`.

---

## Technical

**Does it work on all KMP platforms?**

Android, iOS, macOS, JVM (Desktop), JS (Web), Wasm. The URL opener (`PayCraftPlatform`) has platform-specific implementations for each.

**What's the minimum Android SDK?**

24 (Android 7.0).

**Does it require Compose Multiplatform?**

The UI layer (PayCraftPaywall, PayCraftBanner, etc.) requires Compose Multiplatform. The core (`BillingManager`, `PayCraft.configure`) is pure Kotlin and works without Compose.

**Can I use it without Koin?**

The UI composables use `koinInject()` by default. Pass `billingManager` explicitly to use without Koin:

```kotlin
val billingManager = PayCraftBillingManager(service, store)
PayCraftPaywall(
    onDismiss = { },
    billingManager = billingManager,
)
```

**How does the persistence layer work?**

Email is saved using `multiplatform-settings` (backed by SharedPreferences on Android, NSUserDefaults on iOS, Java Preferences on Desktop). Premium status is NOT cached — it's always re-checked from Supabase on each app start.

**What happens on network error?**

`BillingManager.billingState` emits `BillingState.Error`. The UI shows a retry button. If the user was previously premium and the network fails, they're shown as not-premium (fail-closed). Use `refreshStatus()` to retry.

**Can I use a different DI framework?**

Yes. `PayCraftModule` is a Koin module but you can instantiate manually:

```kotlin
val supabaseClient = createSupabaseClient(url, anonKey) { install(Postgrest) }
val service = PayCraftServiceImpl(supabaseClient.postgrest)
val store = PayCraftSettingsStore()
val billingManager = PayCraftBillingManager(service, store)
```

---

## Setup

**How long does setup take?**

With Claude AI (`/setup`): ~15 minutes.
Manual: ~45 minutes.

**Can I test without real payments?**

Yes. Use Stripe test mode payment links (prefix: `https://buy.stripe.com/test_...`) and test webhooks from Stripe CLI:
```bash
stripe listen --forward-to https://YOUR_REF.functions.supabase.co/stripe-webhook
stripe trigger checkout.session.completed
```

**Does the webhook need to be public?**

Yes, Stripe/Razorpay need to reach it. Supabase Edge Functions are publicly accessible at `https://[ref].functions.supabase.co/[name]`.
