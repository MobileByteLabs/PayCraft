# PayCraft

[![CI](https://github.com/MobileByteLabs/PayCraft/actions/workflows/gradle.yml/badge.svg)](https://github.com/MobileByteLabs/PayCraft/actions/workflows/gradle.yml)
[![Maven Central](https://img.shields.io/maven-central/v/io.github.mobilebytelabs/paycraft)](https://central.sonatype.com/artifact/io.github.mobilebytelabs/paycraft)
[![Kotlin](https://img.shields.io/badge/kotlin-2.1.0-blue.svg?logo=kotlin)](http://kotlinlang.org)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

> **Craft your own billing. Any provider. Any platform. 15 minutes.**

Self-hosted, provider-agnostic billing library for Kotlin Multiplatform apps.
Uses **Supabase** as the source of truth — your app never talks to a payment provider directly.

```
Client App ──→ PayCraft ──→ Supabase (source of truth)
                             ↑
Payment Provider ──webhook──┘
```

## Features

- **Provider-agnostic** — Stripe, Razorpay, or bring your own checkout URLs
- **No fees** — zero per-transaction cuts (beyond your payment provider)
- **Self-hosted** — you own the data in your own Supabase project
- **KMP + Compose** — works on Android, iOS, macOS, JVM, JS, and Wasm
- **Paywall UI included** — `PayCraftSheet`, `PayCraftBanner`, `PayCraftRestore` out of the box
- **Koin DI** — drop in `PayCraftModule`, get `BillingManager` everywhere
- **15-minute setup** — `/setup` Claude skill automates the entire server side

## Installation

Add to `gradle/libs.versions.toml`:

```toml
[versions]
paycraft = "1.0.0"

[libraries]
paycraft = { module = "io.github.mobilebytelabs:paycraft", version.ref = "paycraft" }
```

Add to your shared module's `build.gradle.kts`:

```kotlin
commonMain.dependencies {
    implementation(libs.paycraft)
}
```

## Quick Start

### 1. Configure PayCraft (before Koin)

```kotlin
PayCraft.configure {
    supabase(
        url = BuildConfig.SUPABASE_URL,
        anonKey = BuildConfig.SUPABASE_ANON_KEY,
    )
    provider(
        StripeProvider(
            paymentLinks = mapOf(
                "monthly"   to BuildConfig.STRIPE_MONTHLY_LINK,
                "quarterly" to BuildConfig.STRIPE_QUARTERLY_LINK,
                "yearly"    to BuildConfig.STRIPE_YEARLY_LINK,
            ),
            customerPortalUrl = BuildConfig.STRIPE_PORTAL_URL,
        )
    )
    plans(
        BillingPlan(id = "monthly",   name = "Monthly",   price = "₹99",   interval = "/month"),
        BillingPlan(id = "quarterly", name = "Quarterly", price = "₹249",  interval = "/3 months"),
        BillingPlan(id = "yearly",    name = "Yearly",    price = "₹799",  interval = "/year", isPopular = true),
    )
    benefits(
        BillingBenefit(icon = Icons.Default.Block,    text = "Ad-free experience"),
        BillingBenefit(icon = Icons.Default.Download, text = "Unlimited downloads"),
    )
    supportEmail("support@yourdomain.com")
}
```

### 2. Add PayCraftModule to Koin

```kotlin
startKoin {
    androidContext(this@App)
    modules(
        yourModules,
        PayCraftModule,  // ← add this
    )
}
```

### 3. Use in UI

```kotlin
// Bottom-sheet paywall
var showPaywall by remember { mutableStateOf(false) }

PayCraftSheet(
    visible = showPaywall,
    onDismiss = { showPaywall = false },
)

// Settings banner (free: upgrade CTA, premium: manage)
PayCraftBanner(
    onClick = { showPaywall = true },
    onRestoreClick = { showRestore = true },
)

// Gate content behind premium
PayCraftPremiumGuard(
    fallback = { /* show upgrade prompt */ },
) {
    PremiumContent()
}
```

### 4. Check premium status

```kotlin
class MyViewModel(private val billing: BillingManager) : ViewModel() {
    val isPremium = billing.isPremium  // StateFlow<Boolean>
}
```

## Server Setup

PayCraft needs two things server-side:
1. A Supabase `subscriptions` table + RPCs
2. A webhook Edge Function per payment provider

**Automated (recommended):** Use the `/setup` Claude skill in this repo to do everything automatically.

**Manual:** Follow `docs/QUICK_START.md`.

## Providers

| Provider | Status | Checkout | Notes |
|----------|--------|----------|-------|
| Stripe | Stable | Payment Links | Webhook: `stripe-webhook` |
| Razorpay | Stable | Payment Links | Webhook: `razorpay-webhook` |
| Custom | Stable | Any URL | Implement `PaymentProvider` interface |

## UI Components

| Component | Description |
|-----------|-------------|
| `PayCraftSheet` | Conditional bottom-sheet paywall |
| `PayCraftPaywall` | Full-screen paywall |
| `PayCraftPaywallSheet` | Bottom-sheet paywall (direct) |
| `PayCraftBanner` | Settings row — upgrade CTA or premium status |
| `PayCraftRestore` | Email-based restore purchases dialog |
| `PayCraftPremiumGuard` | Gate any composable behind premium |

## Supported Platforms

| Platform | Targets |
|----------|---------|
| Android | `android` |
| iOS | `iosX64`, `iosArm64`, `iosSimulatorArm64` |
| macOS | `macosX64`, `macosArm64` |
| JVM | `jvm` |
| JavaScript | `js` (Browser, Node.js) |
| WebAssembly | `wasmJs` (Browser) |

## Documentation

- [Quick Start](docs/QUICK_START.md) — 15-minute setup guide
- [Architecture](docs/ARCHITECTURE.md) — how it works under the hood
- [Providers](docs/PROVIDERS.md) — Stripe, Razorpay, custom
- [Customization](docs/CUSTOMIZATION.md) — theme, slot API, custom UI
- [Security](docs/SECURITY.md) — webhook verification, key management
- [FAQ](docs/FAQ.md) — common questions

## Claude Skills

| Skill | What it does |
|-------|-------------|
| `/setup` | Full automated setup (Supabase + Stripe/Razorpay + verify) |
| `/setup-stripe` | Create Stripe products, prices, payment links |
| `/setup-supabase` | Apply migrations, deploy webhook |
| `/verify` | End-to-end integration check |

Copy `client-skills/` to your app's `.claude/commands/` to get:
- `/paycraft-setup` — integrate PayCraft into your KMP app
- `/paycraft-verify` — verify the integration is correct

## Building

```bash
# Build everything
./gradlew build

# Run tests
./gradlew allTests
./gradlew jvmTest

# Run sample app (desktop)
./gradlew :sample-app:run

# Code quality
./gradlew spotlessApply
./gradlew detekt
```

## Publishing

```bash
# Publish to Maven Central
./gradlew publishToMavenCentral

# Required GitHub secrets:
# MAVEN_CENTRAL_USERNAME, MAVEN_CENTRAL_PASSWORD
# SIGNING_KEY_ID, SIGNING_PASSWORD, GPG_KEY_CONTENTS
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

```
Copyright 2026 MobileByteLabs

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
