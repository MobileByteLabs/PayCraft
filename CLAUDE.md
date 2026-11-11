# PayCraft — Claude Instructions

> Self-hosted, multi-provider billing library for KMP apps.
> "Craft your own billing. Any provider. Any platform. 15 minutes."

## Architecture

```
Client App → PayCraft library → Supabase (source of truth)
Payment Provider (Stripe/Razorpay) → Webhook → Supabase
```

The app NEVER talks to the payment provider directly. It only queries Supabase.
Webhooks keep Supabase in sync with the payment provider.

## Key Files

| File | Purpose |
|------|---------|
| `cmp-paycraft/` | KMP library module |
| `PayCraft.kt` | Singleton config — entry point |
| `core/BillingManager.kt` | Interface — isPremium, logIn, logOut, refreshStatus(force) |
| `core/PayCraftBillingManager.kt` | Implementation — cache-first init + smart sync |
| `core/SyncPolicy.kt` | Tiered sync intervals (weekly/daily/hourly) |
| `provider/PaymentProvider.kt` | Provider interface (Stripe, Razorpay, Custom) |
| `network/PayCraftService.kt` | Supabase RPC calls |
| `persistence/PayCraftStore.kt` | Email + subscription cache interface |
| `persistence/PayCraftSettingsStore.kt` | multiplatform-settings cache implementation |
| `platform/TimeProvider.kt` | expect/actual currentTimeMillis() (6 platforms) |
| `ui/PayCraftPaywall.kt` | Default paywall UI |
| `di/PayCraftModule.kt` | Koin DI module |
| `server/migrations/` | SQL for subscriptions table + RPCs |
| `server/functions/` | Webhook Edge Functions per provider |

## Commands

| Command | Purpose |
|---------|---------|
| `/paycraft-adopt` | **E2E adoption: env + Supabase + provider + client + verify (START HERE)** |
| `/paycraft-adopt-env` | Phase 1: env bootstrap + key validation only |
| `/paycraft-adopt-supabase` | Phase 2: Supabase migrations + webhook only |
| `/paycraft-adopt-stripe` | Phase 3: Stripe test setup only |
| `/paycraft-adopt-razorpay` | Phase 3B: Razorpay setup only |
| `/paycraft-adopt-client` | Phase 4: client app integration only |
| `/paycraft-adopt-verify` | Phase 5: end-to-end verification only |
| `/setup` | Legacy full setup (Supabase + provider) |
| `/setup-stripe` | Create Stripe products, prices, payment links |
| `/setup-razorpay` | Create Razorpay subscription plans |
| `/setup-supabase` | Create table, RPCs, deploy webhook |
| `/add-provider` | Add a new payment provider implementation |
| `/add-plan` | Add a new subscription plan |
| `/verify` | Test entire setup end-to-end |

## Provider Design

All providers implement `PaymentProvider` interface:
- `StripeProvider` — uses Stripe Payment Links
- `RazorpayProvider` — uses Razorpay Payment Links
- `CustomProvider` — bring your own checkout URLs

To add a new provider:
1. Implement `PaymentProvider` interface
2. Create webhook Edge Function in `server/functions/{name}-webhook/`
3. Use shared `handleSubscriptionEvent()` from `_shared/subscription-handler.ts`

## Client App Integration

Client apps add PayCraft with:
```kotlin
implementation("io.github.mobilebytelabs:cmp-paycraft:VERSION")
```

Then boot with one line:
```kotlin
PayCraft.initialize(apiKey = "pk_live_…")
```

Products, providers, payment links, pricing, and paywall styling are fetched from
the PayCraft dashboard (https://paycraft.mobilebytesensei.com). For offline previews + UI tests:
`PayCraft.initialize(apiKey = "pk_test_…", backend = PayCraftBackend.Mock(staticConfig = …))`.

> v1.x `PayCraft.configure { … }` was removed in v2.0. Migration:
> [paycraft.mobilebytesensei.com/docs/v2-migration](https://paycraft.mobilebytesensei.com/docs/v2-migration).

## Product SKU naming — single source of truth

A SKU (the catalogue id apps and websites buy by, e.g. `/checkout/?plan=pro-monthly`) is **lowercase
kebab-case, 2–64 characters**: `pro-monthly`, `pro-quarterly`, `pro-semiannual`, `pro-annual`,
`pro-lifetime`, `coins-100`. The **database owns the rule** — migration 179
(`paycraft_sku_is_canonical` + the `tenant_products_sku_convention` trigger) refuses a new or renamed SKU
that breaks it, whichever writer sends it (dashboard, `/v1/products`, MCP, onboarding, SQL).
`dashboard/lib/sku.ts` mirrors the pattern for early form/API errors and `skuFor(tier, interval)` names
tiers; `__tests__/lib/sku.test.ts` fails if the mirror drifts from the migration.

- Store product ids are **not** SKUs: they live in `play_product_id` / `app_store_product_id` with the
  stores' own rules (reverse-DNS, no hyphens on Play).
- SKUs created before 179 (e.g. `com.mobilebytesensei.cappy.sub.week`, `cappy_plus_monthly`) are
  grandfathered — they keep working and can be edited; only a NEW or RENAMED SKU must follow the rule.
- Test fixtures use the convention too (`pro-monthly`, not `pro_monthly`).

## Paywall events, exit survey and win-back — single source of truth

- **Events:** `cmp-paycraft-core/.../analytics/PayCraftEvent.kt` (`PayCraftEventName`, `PayCraftStep`) is THE
  catalog — `paycraft_` + GA4-valid snake_case. SDK code emits the enum, never a string:
  `infra/event-catalog-check.sh` fails on a raw `"paycraft_*"` at an emit call and on a stale server copy
  (`supabase/functions/_shared/event-catalog.ts`, regenerated with `--emit-ts`). `infra/event-pii-check.sh` holds
  every layer an event crosses (fields → `params()` → `eventsBody` → `events` rows → `paywall_events`) to an
  allowlist: no email, name or free text; the buyer is only ever a hash (`user_ref`).
- **Where they go:** PayCraft's own funnel (`events` function → `paywall_events`, migration 180; dashboard
  Analytics) and the app's / site's analytics, which the integrator wires:
  `PayCraft.analyticsListener = PayCraftAnalyticsListener { name, params -> firebaseAnalytics.logEvent(name, params) }`
  (apps), `pc.onEvent((name, params) => gtag("event", name, params))` (sites). `PayCraft.paywallPlacement` names the
  screen that opened the paywall (`trigger`).
- **Exit survey:** `tenant_exit_survey` (181) — edited on dashboard ▸ Paywall ▸ Exit survey and saved only through
  `tenant_exit_survey_save` (183), which owns the rules; `dashboard/lib/exit-survey-config.ts` mirrors them with the
  same error codes. Served in `/config` as `exit_survey`; shown in place of the paywall (mobile) or as a dialog
  (web, `cmp-paycraft-web-ui`'s `showExitSurvey`) at most once per `survey_cap_days` (`exitSurveyDue`, core).
- **Win-back offers:** an answer goes to the `winback` function → `winback_offers` (one per buyer per coupon,
  expiring after `offer_hours`), with the lanes the coupon reaches (`_shared/winback-offer.ts#lanesFor`). Claimed,
  it rides into checkout: `checkout-initiate` applies it (Stripe discount / Razorpay offer; 409 `offer_not_usable`
  → retried at full price), Google Play uses the coupon's offer id, the App Store a server-signed promotional offer.
- **Web:** `cmp-paycraft-web` (≤ 150 KB, every page) stays free of UI; the checkout page and the survey live in
  `cmp-paycraft-web-ui` (≤ 20 KB, imported lazily by buyers), which depends on the stdlib only and calls the page's
  `PayCraftWeb` through `PayCraftWebApi` — `infra/web-ui-api-check.sh` keeps the two in step,
  `infra/web-bundle-size.sh` holds both budgets.
- **GA4 on the dashboard:** tenants add PayCraft's service account (`paycraft-ga4-service-account`, env
  `PAYCRAFT_GA4_SA_JSON`) as a Viewer on their property; `tenant_ga4_connections` (184) stores only the property id.

## Database Migrations — single source of truth

**All SQL migrations live in `supabase/migrations/`.** That is the only directory
`supabase start` / `supabase migration up` read from. Do NOT create a parallel
`dashboard/supabase/migrations/` (or any other mirror) — it produces silent drift:
the Dashboard team writes new RPCs there, `supabase start` never sees them, the
DB stays at the old schema, and `requireTenant()` / Edge Functions fail at runtime
with "RPC not found" instead of a clear migration error.

Rules:
- New migration → `supabase/migrations/NNN_descriptive_name.sql`. Bump NNN by 1.
- Edits to existing migrations are forbidden once applied in any environment;
  add a follow-up migration instead.
- Every migration must be **idempotent**: `CREATE TYPE` wrapped in
  `DO $$ … pg_type WHERE typname … $$`, `CREATE POLICY` preceded by
  `DROP POLICY IF EXISTS`, `ADD CONSTRAINT` wrapped in
  `DO $$ … pg_constraint WHERE conname … $$`. This survives `supabase db reset`
  and partial-apply recovery.
- Track applied state via `supabase_migrations.schema_migrations` (auto-managed).
  Inspect with: `docker exec supabase_db_PayCraft psql -U postgres -d postgres
  -c "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version"`.
