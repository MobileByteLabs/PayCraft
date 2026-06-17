# cmp-paycraft — Kotlin Multiplatform billing SDK

[![Maven Central](https://img.shields.io/maven-central/v/io.github.mobilebytelabs/cmp-paycraft.svg)](https://search.maven.org/artifact/io.github.mobilebytelabs/cmp-paycraft)

The official Kotlin Multiplatform SDK for [PayCraft](https://paycraft.mobilebytesensei.com)
— a self-hostable, multi-provider billing layer for KMP apps.

**Used in production** by reels-downloader (Android + iOS + Web + Desktop) since
2026-04-26.

---

## Install

```kotlin
// build.gradle.kts — in your KMP module's commonMain
dependencies {
    implementation("io.github.mobilebytelabs:cmp-paycraft:2.0.0")
}
```

Supported targets:

- Android (SDK 21+)
- iOS (arm64 / x64 / simulator-arm64)
- JVM
- JS (browser / node)
- WASM-JS
- macOS (arm64 / x64)

---

## Quick start

### 1. Initialize once at app startup

```kotlin
import com.mobilebytelabs.paycraft.PayCraft

class MyApplication {
    fun onCreate() {
        PayCraft.initialize(apiKey = "pk_live_…")
    }
}
```

Get your `pk_live_*` key from the PayCraft dashboard → Settings → API Keys.

### 2. Gate features with `BillingManager`

```kotlin
import com.mobilebytelabs.paycraft.core.BillingManager

if (BillingManager.isPremium(uid = "user@example.com")) {
    showPremiumScreen()
} else {
    showPaywall()
}
```

`isPremium` is cache-first (weekly default, hourly for trial users); zero
network on the happy path.

### 3. Sign in / sign out (track per-user entitlement)

```kotlin
BillingManager.logIn(uid = "user@example.com")
// ... later ...
BillingManager.logOut()
```

### 4. Force-refresh after a likely purchase

```kotlin
BillingManager.refreshStatus(force = true)
```

---

## Backends

PayCraft supports three backend modes:

```kotlin
import com.mobilebytelabs.paycraft.PayCraftBackend

// 1. Cloud (default) — paycraft.mobilebytesensei.com
PayCraft.initialize(
    apiKey = "pk_live_…",
    backend = PayCraftBackend.Cloud,
)

// 2. SelfHosted — your own Supabase + Edge Functions
PayCraft.initialize(
    apiKey = "pk_live_…",
    backend = PayCraftBackend.SelfHosted(supabaseUrl = "https://your.supabase.co"),
)

// 3. Mock — for UI tests / previews
PayCraft.initialize(
    apiKey = "pk_test_…",
    backend = PayCraftBackend.Mock(staticConfig = SuiteConfig(/* fixture */)),
)
```

---

## What PayCraft handles for you

- **Multi-provider checkout routing** — Stripe (global), Razorpay (India),
  Cashfree, PayPal, Paystack, Flutterwave, Lemonsqueezy, Paddle, Midtrans,
  BTCPay. Pick the cheapest provider per region from your tenant dashboard.
- **Webhook reception** — provider events normalize to a single internal
  schema; you don't write webhook handlers.
- **Per-user entitlement cache** — tiered sync (weekly / daily / hourly)
  with offline fallback.
- **Trial sticky-fields** — trial start/end persist across renewals and
  cancel/resub flows.

---

## Architecture

```
Your KMP app
    │
    ▼
cmp-paycraft (this library)
    │   PayCraft.initialize(apiKey)
    │   BillingManager.isPremium(uid)
    │
    ▼
paycraft.mobilebytesensei.com  (or your self-hosted endpoint)
    │   /api/* — entitlement checks
    │
    ▼
Supabase (Postgres + Edge Functions)
    │
    ▲   Stripe / Razorpay / etc.
    │   webhooks (provider → PayCraft)
```

The app never talks to Stripe or Razorpay directly — PayCraft does it on your
behalf.

---

## Docs

Full guide: [docs.paycraft.mobilebytesensei.com](https://docs.paycraft.mobilebytesensei.com)

Topics covered:

- Quickstart (Cloud + self-hosted)
- Provider setup (Stripe Connect / Razorpay / others)
- Webhook flow
- Trial & grace period semantics
- Mocking for UI tests
- KMP target-specific notes (iOS, JVM, Web)

---

## Real-world integration

See [docs/REELS_DOWNLOADER_INTEGRATION.md](../docs/REELS_DOWNLOADER_INTEGRATION.md)
in this repo for the canonical real-world case study covering:

- Tenant onboarding
- Stripe Connect OAuth
- Product + pricing creation
- End-user purchase → webhook → SDK gate
- Trial verification

---

## License

Apache-2.0. See [LICENSE](../LICENSE).

---

## Author

[MobileByteLabs](https://github.com/MobileByteLabs) — KMP tooling + production
SaaS infrastructure.
