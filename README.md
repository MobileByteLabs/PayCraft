# PayCraft

[![CI](https://github.com/MobileByteLabs/PayCraft/actions/workflows/gradle.yml/badge.svg)](https://github.com/MobileByteLabs/PayCraft/actions/workflows/gradle.yml)
[![Maven Central](https://img.shields.io/maven-central/v/io.github.mobilebytelabs/paycraft?label=Maven%20Central)](https://central.sonatype.com/artifact/io.github.mobilebytelabs/paycraft)
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

---

## Adopt with Claude AI (Recommended)

The fastest way to add PayCraft billing to your KMP app — no cloning, no setup, one prompt.

### Step 1 — Open Claude Code in your KMP app

```bash
cd /path/to/your-kmp-app
claude
```

### Step 2 — Paste this one prompt

```
Fetch https://raw.githubusercontent.com/mobilebytelabs/paycraft/main/client-skills/paycraft-adopt.md
Save it to .claude/commands/paycraft-adopt.md in this project, then run /paycraft-adopt.
```

That's it. Claude handles everything from here:

| Phase | What Claude does | What you do |
|-------|-----------------|-------------|
| **Bootstrap** | Searches for PayCraft locally, offers to clone it if not found — **asks where on your system** | Pick a location (or press Enter for `~/paycraft/`) |
| **Phase 1 — ENV** | Creates `.env`, walks you through each credential | Answer ~8 questions (Supabase keys, Stripe key, plans) |
| **Phase 2 — Supabase** | Applies migrations, creates RPCs, deploys webhook, verifies every step | Nothing |
| **Phase 3 — Stripe** | Creates test product, prices, payment links automatically via Stripe MCP | 2 browser steps: add webhook endpoint + enable portal |
| **Phase 4 — Client** | Adds dependency, writes `PayCraft.configure()`, wires Koin + paywall UI | Nothing |
| **Phase 5 — Verify** | Writes real DB row, calls `is_premium()`, confirms `true`, cleans up | Nothing |

**Result:** fully operational billing in test mode. No real charges until you opt in.

### Re-run individual phases anytime

After setup, these commands are available in your project:

```
/paycraft-adopt-env        ← re-collect credentials (key rotation)
/paycraft-adopt-supabase   ← re-deploy webhook or re-apply migrations
/paycraft-adopt-stripe     ← create live products when ready to ship
/paycraft-adopt-client     ← re-integrate into a different app
/paycraft-adopt-verify     ← re-verify after any config change
/paycraft-adopt-migrate    ← migrate to new Supabase/Stripe account or switch providers
```

### Deployment context

After setup completes, your app contains a `.paycraft/` directory — a complete record of
how PayCraft is configured in your project:

```
your-app/
├── .env                      ← gitignored (auto-added by setup) — all PayCraft keys
└── .paycraft/
    ├── config.json           ← setup answers — safe to commit
    ├── deployment.json       ← resource IDs, no secrets — safe to commit
    ├── supabase/             ← SQL + Edge Function backup — safe to commit
    └── backups/              ← gitignored — timestamped .env copies
```

Step 5 automatically adds `.env` and `.paycraft/backups/` to your `.gitignore`.
Everything else in `.paycraft/` is safe to commit as deployment documentation.

### Prerequisites

- [Claude Code](https://claude.ai/code) CLI (`npm install -g @anthropic-ai/claude-code`)
- KMP app with Koin DI
- [Supabase](https://supabase.com) project (free tier works)
- [Stripe](https://stripe.com) or [Razorpay](https://razorpay.com) account (test mode for setup)

### Migrate later

Moving to a new Supabase org, rotating Stripe accounts, or switching from Stripe to Razorpay?

```
/paycraft-adopt-migrate
```

Claude shows your current deployment, asks what's changing, backs up your `.env`, collects
only the new credentials, re-deploys only the affected components, and re-verifies end-to-end.
No full re-setup. Subscriber data migration included (optional).

| Migration | Command handles |
|-----------|----------------|
| New Supabase project | Re-deploys migrations + webhook, migrates subscriber data |
| New Stripe account | Re-creates products, prices, payment links, webhook |
| New Razorpay account | Re-creates plans, payment links, webhook |
| Stripe → Razorpay | Full provider switch, updates app config |
| Razorpay → Stripe | Full provider switch, updates app config |

---

## Features

- **Provider-agnostic** — Stripe, Razorpay, or bring your own checkout URLs
- **No fees** — zero per-transaction cuts (beyond your payment provider)
- **Self-hosted** — you own the data in your own Supabase project
- **KMP + Compose** — works on Android, iOS, macOS, JVM, JS, and Wasm
- **Paywall UI included** — `PayCraftSheet`, `PayCraftBanner`, `PayCraftRestore` out of the box
- **Koin DI** — drop in `PayCraftModule`, get `BillingManager` everywhere

---

## Manual Setup

If you prefer to set up without Claude AI, see [docs/QUICK_START.md](docs/QUICK_START.md).

### Add dependency

```toml
# gradle/libs.versions.toml
[versions]
paycraft = "LATEST_VERSION"   # check Maven Central badge above

[libraries]
paycraft = { module = "io.github.mobilebytelabs:paycraft", version.ref = "paycraft" }
```

```kotlin
// shared/build.gradle.kts — commonMain ONLY
commonMain.dependencies {
    implementation(libs.paycraft)
}
```

### Configure (before Koin)

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
        BillingPlan(id = "monthly",   name = "Monthly",   price = "₹99",  interval = "/month"),
        BillingPlan(id = "quarterly", name = "Quarterly", price = "₹249", interval = "/3 months"),
        BillingPlan(id = "yearly",    name = "Yearly",    price = "₹799", interval = "/year", isPopular = true),
    )
    benefits(
        BillingBenefit(icon = Icons.Default.Block,    text = "Ad-free experience"),
        BillingBenefit(icon = Icons.Default.Download, text = "Unlimited downloads"),
    )
    supportEmail("support@yourdomain.com")
}
```

### Add Koin module

```kotlin
startKoin {
    modules(yourModules, PayCraftModule)
}
```

### Add UI

```kotlin
var showPaywall by remember { mutableStateOf(false) }
var showRestore by remember { mutableStateOf(false) }

PayCraftBanner(
    onClick = { showPaywall = true },
    onRestoreClick = { showRestore = true },
)

PayCraftSheet(visible = showPaywall, onDismiss = { showPaywall = false })
PayCraftRestore(visible = showRestore, onDismiss = { showRestore = false })
```

### Gate premium features

```kotlin
val isPremium by billingManager.isPremium.collectAsState()

if (isPremium) PremiumContent() else FreeContent()
```

---

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

---

## Documentation

- [Quick Start](docs/QUICK_START.md) — manual 15-minute setup guide
- [Architecture](docs/ARCHITECTURE.md) — how it works under the hood
- [Providers](docs/PROVIDERS.md) — Stripe, Razorpay, custom
- [Customization](docs/CUSTOMIZATION.md) — theme, slot API, custom UI
- [Security](docs/SECURITY.md) — webhook verification, key management
- [Claude Skills](docs/CLAUDE_SKILLS.md) — all available Claude commands

---

## Building

```bash
./gradlew jvmTest          # run tests
./gradlew :sample-app:run  # desktop sample
./gradlew spotlessApply    # format
./gradlew detekt           # lint
```

## Releasing

```bash
./scripts/release.sh
# or: /lib-release in Claude Code
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
