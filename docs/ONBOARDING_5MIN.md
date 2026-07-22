# 5-Minute Onboarding

Get PayCraft from zero to a first entitlement read in about five minutes. This is the exact path
the release ship-gate smoke (`scripts/paycraft-onboarding-smoke.sh`, AC10) exercises on every cut —
`paycraft init` → `PayCraft.initialize(apiKey)` → first entitlement read.

## 1. Scaffold config

```bash
npx paycraft init --cloud --api-key pk_test_your_key --provider stripe
```

This writes `paycraft.config.json` (mode, api key, provider, platform) and a `PayCraftInit.kt.txt`
snippet you paste into your app. Run it non-interactively (as the smoke does) with `--yes --out <dir>`,
or omit `--api-key` for the guided interactive setup.

## 2. Boot the SDK — one line

```kotlin
PayCraft.initialize(apiKey = "pk_test_your_key")
```

For offline previews and UI tests, use the in-process Mock backend (no dashboard / no network):

```kotlin
PayCraft.initialize(
    apiKey = "pk_test_your_key",
    backend = PayCraftBackend.Mock(staticConfig = /* your SuiteConfig */),
)
```

## 3. First entitlement read

Collect `BillingManager.billingState` — the first read resolves cache-first from the offline
last-known-good entitlement (grace = active), so gating is correct even with no network on cold start:

```kotlin
val manager: BillingManager = koinInject()
val state by manager.billingState.collectAsState()
val isPremium = state is BillingState.Premium
```

## Verify it end-to-end

```bash
# init -> initialize -> first entitlement read; exits 0
bash scripts/paycraft-onboarding-smoke.sh
```

The smoke builds the CLI, scaffolds a config, then runs the executed `OnboardingSmokeTest`
(`:cmp-paycraft:jvmTest`) which proves `initialize` + the first cache-first entitlement read and
emits `entitlement-read-ok`.

## Device-verified providers

Apple/StoreKit, Google/Play, Stripe, and Razorpay are each device-verified on-device via the
`maestro/paycraft_<provider>_<platform>_flow.yaml` ship-gate flows (state-accuracy + restore +
cancel/manage), run by `scripts/paycraft-device-verify.sh`. See the release gate (D14) for the full
provider × platform matrix.
