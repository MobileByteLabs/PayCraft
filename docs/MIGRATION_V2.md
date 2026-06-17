# Adopting PayCraft Cloud Dashboard Configuration

## Overview

PayCraft supports two configuration paths:

**In-code configuration** — products, plans, and paywall settings are declared directly in
your app's Kotlin source via `PayCraft.configure {}`. No network dependency at startup.

**Cloud dashboard configuration** — a single API key is provided at startup; all products,
providers, pricing, paywall template, branding, trial settings, and webhooks are managed from
the PayCraft Dashboard at https://paycraft.mobilebytesensei.com. Settings propagate to all app installs
without requiring an app update.

Both paths are fully supported in production.

---

## In-code configuration (self-contained)

```kotlin
PayCraft.configure {
    supabase(url = "https://abc.supabase.co", anonKey = "...")
    provider(StripeProvider(paymentLinks = mapOf(
        "monthly" to "https://buy.stripe.com/...",
        "yearly"  to "https://buy.stripe.com/...",
    )))
    plans(
        BillingPlan(id = "monthly", name = "Monthly", price = "$4.99", interval = "month", rank = 1),
        BillingPlan(id = "yearly",  name = "Yearly",  price = "$39.99", interval = "year", rank = 2),
    )
    supportEmail("help@myapp.com")
}
```

Use this path when you want full control in code, no external dependencies at runtime, or
a self-hosted Supabase backend.

---

## Cloud dashboard configuration (recommended for teams)

```kotlin
PayCraft.initialize(apiKey = "pk_live_abc123")
```

Everything else — products, providers, pricing, paywall template, branding, trial, webhooks —
is configured in the dashboard at https://paycraft.mobilebytesensei.com.

### Self-hosted Enterprise variant

```kotlin
PayCraft.initialize(
    apiKey  = "pk_live_abc123",
    backend = PayCraftBackend.SelfHosted(
        supabaseUrl     = "https://billing.acme.com",
        supabaseAnonKey = "eyJ...",
    )
)
```

---

## Switching from in-code to dashboard configuration

### Automated helper (optional)

The `paycraftMigrateV2` Gradle task assists teams that want to move an existing in-code
`PayCraft.configure {}` block to a cloud dashboard setup:

1. **Dry-run** — preview changes without writing:
   ```bash
   ./gradlew :app:paycraftMigrateV2
   ```

2. **Apply** — rewrite the configure block and emit a setup checklist:
   ```bash
   ./gradlew :app:paycraftMigrateV2 -Papply=true
   ```
   This:
   - Rewrites `PayCraft.configure { ... }` → `PayCraft.initialize(apiKey = "pk_live_FROM_DASHBOARD")`
   - Backs up original files to `.paycraft-backup/`
   - Emits `MIGRATION_DASHBOARD_CHECKLIST.md`

3. **Sign up** at https://paycraft.mobilebytesensei.com/auth/signup — create your app, copy the API key.

4. **Follow `MIGRATION_DASHBOARD_CHECKLIST.md`** — re-create products, connect providers, set up webhooks.

5. **Paste the API key** into the rewritten `PayCraft.initialize(apiKey = "pk_live_...")` call.

6. **Rebuild + test** — run your app, open the paywall, complete a test payment.

### Manual switch

1. Delete the `PayCraft.configure { ... }` block.
2. Add `PayCraft.initialize(apiKey = "pk_live_...")` (using the key from the dashboard).
3. Re-create all products, providers, and paywall settings in the dashboard.

---

## Rollback

If you used the automated helper, `.paycraft-backup/` mirrors the original source tree:

```bash
cp -r .paycraft-backup/app/src app/src    # restore source files
```

---

## FAQ

**Do I lose customer subscription data when switching?**
No. Subscriptions, devices, and webhook logs are scoped to `tenant_id` on the Supabase side.
When you create your app in the PayCraft dashboard with the same bundle ID, existing subscribers
remain active.

**What if I'm using self-hosted Supabase?**
Use `PayCraft.initialize(apiKey, backend = PayCraftBackend.SelfHosted(...))` instead of
`PayCraft.configure {}`.

**What happens to my Stripe/Razorpay webhooks?**
Webhook URLs are shown in the PayCraft Dashboard under `/webhooks`. Update the URL in your
Stripe or Razorpay dashboard to the new value.

**What about ProGuard / R8?**
No changes needed. The public SDK surface is identical across both configuration paths.

**Can I keep using `PayCraftPaywall()` composable?**
Yes — the composable API is unchanged. When using the dashboard path, PayCraft fetches paywall
config (template, theme, branding, products) from the cloud automatically.

---

## Version history

| Version | Change |
|---------|--------|
| v2.0.0  | Cloud dashboard configuration — `PayCraft.initialize(apiKey)`, multi-provider picker, branding footer |
| v1.1.0  | Trial support (`BillingPlan.trialDays`, `BillingState.Premium.trial`) |
| v1.0.0  | Initial release — multi-provider, in-code configuration |
