# PayCraft Quick Start — 15 Minutes to Billing

Get PayCraft running in your KMP app in 15 minutes using Claude AI.

## Prerequisites

- KMP app with Koin DI
- Supabase project (free tier works)
- Stripe or Razorpay account
- Claude Code with Stripe MCP (optional but recommended)

---

## Option A: Claude AI Setup (Recommended — 20 minutes)

### Single Command Setup

Open Claude Code **in the PayCraft repo** and run:

```
/paycraft-adopt
```

Claude handles everything end-to-end:
1. Creates `.env` from `.env.example` and collects all keys
2. Applies Supabase migrations + deploys webhook + verifies
3. Creates Stripe test products, prices, payment links via MCP
4. Walks you through browser steps with exact instructions
5. Wires PayCraft into your app directly
6. Runs a live DB write test to confirm everything works

**Every step is verified immediately. Test mode first. Live mode checklist at the end.**

Claude will ask you (~12 questions):
- Provider (stripe/razorpay)
- Supabase project ref + credentials
- Stripe test API key
- Currency and plan prices
- Which app to integrate billing into

You'll complete ~6 browser steps (Stripe Dashboard, Supabase Dashboard) with exact instructions.

### 3. Verify (automated in /paycraft-adopt)

Verification runs automatically as the final phase of `/paycraft-adopt`.
To re-run verification independently:
```
/paycraft-adopt-verify
```

Done! Your app has a verified billing system in test mode.

---

## Option B: Manual Setup

### Step 1: Add Dependency

```toml
# gradle/libs.versions.toml
[versions]
paycraft = "1.0.0"

[libraries]
paycraft = { module = "io.github.mobilebytelabs:paycraft", version.ref = "paycraft" }
```

```kotlin
// shared/build.gradle.kts
commonMain.dependencies {
    implementation(libs.paycraft)
}
```

### Step 2: Set Up Supabase

Apply the migrations to your Supabase project:

```bash
# Apply manually via Supabase SQL editor, or:
./server/scripts/setup.sh \
  --provider stripe \
  --supabase-ref YOUR_REF \
  --supabase-token YOUR_TOKEN
```

### Step 3: Create Payment Links

**Stripe**: Create payment links in Stripe Dashboard → Payment Links
**Razorpay**: Create payment links in Razorpay Dashboard → Payment Links

### Step 4: Configure PayCraft

In your app initialization (before Koin):

```kotlin
PayCraft.configure {
    supabase(
        url = BuildConfig.SUPABASE_URL,
        anonKey = BuildConfig.SUPABASE_ANON_KEY,
    )
    provider(
        StripeProvider(
            paymentLinks = mapOf(
                "monthly" to "https://buy.stripe.com/YOUR_LINK",
                "yearly"  to "https://buy.stripe.com/YOUR_LINK",
            ),
            customerPortalUrl = "https://billing.stripe.com/p/login/YOUR_ID",
        )
    )
    plans(
        BillingPlan(id = "monthly", name = "Monthly", price = "$9.99", interval = "/month", rank = 1),
        BillingPlan(id = "yearly",  name = "Yearly",  price = "$79.99", interval = "/year",  rank = 2, isPopular = true),
    )
    benefits(
        BillingBenefit(icon = Icons.Default.Star, text = "Unlock all features"),
        BillingBenefit(icon = Icons.Default.Block, text = "Ad-free experience"),
    )
    supportEmail("support@yourapp.com")
}
```

### Step 5: Add Koin Module

```kotlin
startKoin {
    modules(
        yourModules,
        PayCraftModule,
    )
}
```

### Step 6: Add UI to Settings

```kotlin
@Composable
fun SettingsScreen() {
    var showPaywall by remember { mutableStateOf(false) }
    var showRestore by remember { mutableStateOf(false) }

    // ... your other settings ...

    PayCraftBanner(
        onClick = { showPaywall = true },
        onRestoreClick = { showRestore = true },
    )

    PayCraftSheet(visible = showPaywall, onDismiss = { showPaywall = false })
    PayCraftRestore(visible = showRestore, onDismiss = { showRestore = false })
}
```

### Step 7: Gate Premium Features

```kotlin
val billingManager: BillingManager = koinInject()
val isPremium by billingManager.isPremium.collectAsState()

if (isPremium) {
    PremiumContent()
} else {
    FreeContent()
}
```

### Step 8: Set Up Webhook

In Stripe Dashboard → Webhooks → Add endpoint:
- URL: `https://YOUR_SUPABASE_REF.supabase.co/functions/v1/stripe-webhook`
- Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`

Then set the signing secret:
```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_... --project-ref YOUR_REF
```

---

## What Happens at Runtime

1. User opens paywall → `PayCraftPaywall` shows plans
2. User taps plan → `PayCraft.checkout()` opens payment URL in browser
3. User pays → Provider sends webhook to Supabase Edge Function
4. Edge Function upserts `subscriptions` table
5. App calls `is_premium(email)` RPC → returns `true`
6. `BillingManager.isPremium` updates → UI unlocks premium features

---

## Next Steps

- [Architecture](ARCHITECTURE.md) — how the provider-agnostic design works
- [Customization](CUSTOMIZATION.md) — custom themes and UI
- [Adding Providers](PROVIDERS.md) — add Razorpay, PayPal, etc.
- [Security](SECURITY.md) — webhook verification, key management
