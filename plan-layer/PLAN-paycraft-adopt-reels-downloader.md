# PLAN-paycraft-adopt-reels-downloader — PayCraft Integration: reels-downloader

> **Status**: 🟡 In Progress — infrastructure complete; sandbox + live E2E pending
> **Created**: 2026-04-26
> **Consumer App**: mbs/reels-downloader (KMP, Android + iOS)
> **PayCraft Version**: 1.1.0
> **Provider**: Stripe (test mode; live pending)
> **Supabase**: mlwfgytjxlqyfxcgpysm.supabase.co

---

## Integration Summary

PayCraft 1.1.0 is fully wired into reels-downloader. All phases 1–5 of `/paycraft-adopt` are
complete. The `subscriptions` table, RPCs, and Stripe webhook are live in the billing Supabase
project. The app uses `PayCraftBanner` in `SettingsScreen.kt` with KMP-first lifecycle refresh.

---

## What Was Deployed

### Supabase (`mlwfgytjxlqyfxcgpysm`)

| Resource | Status |
|----------|:------:|
| `subscriptions` table (`001_create_subscriptions.sql`) | ✅ Live |
| `is_premium(user_email)` RPC (`002_create_rpcs.sql`) | ✅ Live |
| `get_subscription(user_email)` RPC | ✅ Live |
| RLS enabled on `subscriptions` | ✅ Live |
| `stripe-webhook` Edge Function | ✅ Active |
| `STRIPE_SECRET_KEY` secret | ✅ Set (test mode) |
| `STRIPE_WEBHOOK_SECRET` secret | ✅ Set |

### Stripe (Test Mode — Account: acct_1TQ8CzFRkA21GQgU)

| Resource | Value |
|----------|-------|
| Product | `prod_UOw7btHApXN11Q` |
| Monthly price | `price_1TQ8FeFRkA21GQgUvkFhlsoV` — ₹100/month |
| Quarterly price | `price_1TQ8FfFRkA21GQgUYdXXICnU` — ₹300/quarter |
| Semiannual price | `price_1TQ8FfFRkA21GQgUbxuRQFXR` — ₹600/6 months |
| Yearly price | `price_1TQ8FgFRkA21GQgUAxceXP02` — ₹1000/year |
| Monthly link | `https://buy.stripe.com/test_14AcN580fbx61GUeCD6Vq00` |
| Quarterly link | `https://buy.stripe.com/test_fZu14n0xNgRq4T6cuv6Vq01` |
| Semiannual link | `https://buy.stripe.com/test_6oU6oH6Wb1WwgBO5236Vq02` |
| Yearly link | `https://buy.stripe.com/test_00w7sL5S7fNm1GU9ij6Vq03` |
| Webhook endpoint | `https://mlwfgytjxlqyfxcgpysm.supabase.co/functions/v1/stripe-webhook` |
| Customer portal | `https://billing.stripe.com/p/login/test_5kQfZh80z2l94mO6TY3sI00` |
| All links have `metadata[plan_id]` | ✅ monthly/quarterly/semiannual/yearly |

### App Integration (`reels-downloader/source/reels-downloader/`)

```
core/network/di/NetworkModule.kt
  PayCraft.configure {
      supabase(url = PAYCRAFT_SUPABASE_URL, anonKey = PAYCRAFT_SUPABASE_ANON_KEY)
      provider(StripeProvider(paymentLinks = mapOf(
          "monthly"    to PAYCRAFT_STRIPE_LINK_MONTHLY,
          "quarterly"  to PAYCRAFT_STRIPE_LINK_QUARTERLY,
          "semiannual" to PAYCRAFT_STRIPE_LINK_SEMIANNUAL,
          "yearly"     to PAYCRAFT_STRIPE_LINK_YEARLY,
      )))
      plans(monthly, quarterly, semiannual, yearly)
      benefits(...)
      supportEmail(PAYCRAFT_SUPPORT_EMAIL)
  }

feature/settings/SettingsScreen.kt  (commonMain)
  - payCraftBillingManager: BillingManager = koinInject()
  - LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { payCraftBillingManager.refreshStatus() }
  - PayCraftBanner(billingManager = payCraftBillingManager, ...)

cmp-navigation/di/KoinModules.kt
  - PayCraftModule included in Koin

cmp-android/AndroidManifest.xml
  - Deep link: reelsdownloader://paycraft/premium/success
```

---

## Bugs Fixed During Integration

### 1. Stripe webhook stored price_id not plan name
- **Root cause**: `index.ts` used `sub.items.data[0]?.price?.id` as plan fallback
- **Fix**: Updated to check `session.metadata?.plan_id` first; added `metadata[plan_id]` to all 4 payment links
- **File**: `server/functions/stripe-webhook/index.ts`

### 2. iOS build failure — `FIRCrashlytics` unresolved
- **Root cause**: `core/analytics` module imports `FIRCrashlytics` in iOS actual but had no cocoapods plugin
- **Fix**: Added `alias(libs.plugins.kotlinCocoapods)` + `cocoapods { pod("FirebaseCrashlytics") }` to `core/analytics/build.gradle.kts`
- **Pattern reference**: `core/ui/build.gradle.kts` (same pattern for Google Ads pods)

### 3. Android-specific billing code (REVERTED)
- **Mistake**: Added `SubscriptionManager` injection to `MainActivity.kt` + `onResume()` override
- **Fix**: Fully reverted. Used `LifecycleEventEffect(Lifecycle.Event.ON_RESUME)` in `SettingsScreen.kt` (commonMain)
- **Rule update**: `paycraft-adopt-client.md` now has strict KMP-FIRST enforcement table

---

## Pending

### Phase 5B — Sandbox E2E Test

```
Goal: Complete real payment flow end-to-end with test card.

Steps:
  1. Build + install APK on device
  2. Run /paycraft-adopt → [B] Test sandbox
  3. Open monthly payment link in browser
  4. Pay with: 4242 4242 4242 4242 | Any future expiry | Any CVC | Real email
  5. Verify DB: subscriptions table → status=active, plan=monthly
  6. Verify: is_premium() = true via Supabase anon key
  7. Verify: app SettingsScreen → PayCraftBanner shows premium state
  8. Write: .paycraft/sandbox_test.json (result=PASS)

Expected result:
  - Webhook fires within ~5s of payment
  - DB row created with plan="monthly" (not price_xxx)
  - is_premium() returns true
  - PayCraftBanner shows "Manage Subscription" CTA
```

### Phase 6 — Live Keys Setup

```
Required before going live:
  - Activate Stripe account (identity + bank verification)
  - Obtain sk_live_... from Stripe Dashboard (Live mode)
  - Run Phase 3B to create live products + payment links
  - Register live webhook endpoint in Stripe (Live mode)
  - Update Supabase secrets: STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET
  - Update PayCraftConfig.kt: IS_TEST_MODE = false + LIVE_PAYMENT_LINKS

Guide: /paycraft-adopt → [D] Get keys guide → Section C (Stripe Live Keys)
```

### Phase 5C — Live E2E Test

```
Prerequisites: Phase 5B PASS + Phase 6 complete
  - Real card payment on monthly plan (smallest amount)
  - Verify webhook → DB → is_premium() → app premium state
  - Refund immediately via Stripe Dashboard
  - Write: .paycraft/live_test.json (result=PASS)
```

---

## Commands

| Command | Purpose |
|---------|---------|
| `/paycraft-adopt` | Status matrix + action menu (B/C/D/E/F) |
| `/paycraft-adopt → [B]` | Run Phase 5B sandbox test |
| `/paycraft-adopt → [D]` | Phase 6 real keys guide |
| `/paycraft-adopt → [C]` | Phase 5C live test (requires Phase 6 first) |
| `/paycraft-adopt → [E]` | Re-verify current setup (Phase 5 API checks) |

---

## Framework Plan Reference

Framework-level plan: `plan-layer/plans/PLAN-paycraft-260426-031819.md`
