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
- **Web:** `cmp-paycraft-web` (≤ 157,000 B, every page) stays free of UI; the checkout page and the survey live in
  `cmp-paycraft-web-ui` (≤ 20 KB, imported lazily by buyers), which depends on the stdlib only and calls the page's
  `PayCraftWeb` through `PayCraftWebApi` — `infra/web-ui-api-check.sh` keeps the two in step,
  `infra/web-bundle-size.sh` holds both budgets.
- **Exit offer (226):** `tenant_exit_survey.exit_offer_{enabled,coupon_id}` (saved by `tenant_exit_offer_save`; the
  Exit survey page's first card). Served as `exit_survey.exit_offer`; on close the paywall shows it FIRST (`winback`
  reasonCode `exit_offer` — no survey answer recorded), the survey only if declined; same `survey_cap_days`. Play counts
  a discount in the base plan's periods (`playRecurrenceCount`): "3 months" fits monthly/quarterly only; `winback`
  moves an Android buyer on a plan the coupon can't reach to the shortest plan it can (`pickOfferPlan`) and returns
  that `sku`. Tests: `ExitOfferFlowTest`, `supabase/tests/226_exit_offer_test.sql`.
- **GA4 on the dashboard:** tenants add PayCraft's service account — the org Firebase account
  (`firebase-adminsdk-fbsvc@prod-applications-c7f87.iam.gserviceaccount.com`; alias `paycraft-ga4-service-account` →
  vault `mbs-firebase-service-account`, env `PAYCRAFT_GA4_SA_JSON`, raw or base64 JSON) — as a Viewer on their property; `tenant_ga4_connections` (184) stores only the property id, plus (190) the `stream_ids` that are the tenant's when one property holds several apps — every report (`ga4Overview`) is then filtered by `streamId`.
- **PayCraft's own site analytics:** paycraft.mobilebytesensei.com reports to GA4 stream "PayCraft Production"
  (`G-546MLX2N39`, stream 15137829546) — separate from tenants' properties above. The id is public and lives in
  `deploy-cloud.yml` (`env.PAYCRAFT_GA_ID` → `NEXT_PUBLIC_GA_ID`, inlined at build; the build refuses a missing one) and
  `components/google-analytics.tsx` renders nothing without it. `cloud-smoke.yml` fails if the loader leaves the page.
- **Attribution forwarding (server → the app's ad platforms):** verified lifecycle events — trial start, purchase,
  renewal, refund — go from `reconcileEntitlement()` (the one path every Play / App Store / web-PSP event takes) to
  GA4 (Firebase Measurement Protocol, by `app_instance_id`) and AppsFlyer (S2S events, by `appsflyer_id`) via
  `_shared/attribution.ts` (pure `detectTransition` + payload builders; best-effort sender that never fails a
  webhook; sandbox and untenanted events never sent). Migration 208: `tenant_attribution_integrations` (secret
  pgcrypto-encrypted, write-only — Settings ▸ Ad attribution, `/api/settings/attribution`), `device_attribution_ids`
  (posted by `PayCraft.setAttributionIds(...)` → `attribution-ids` function, apiKey + device token) and
  `attribution_forwards` (UNIQUE integration/provider/txn/kind/period = at most once; `no_ids`/`failed` retried on
  the transaction's next event). `value` = the product's catalogue price, omitted when unknown. Web-PSP refunds are
  not forwarded (the PSP status vocab has no refund). Tests: `__tests__/attribution.test.ts`, `AttributionIdsSyncTest`.

## Paywall A/B experiments — single source of truth

- **What a variant is:** an OFFERING (088) — which plans, at which prices. Migration 206 `paywall_experiments`
  (`key`, `status` draft → running → stopped, `variants` `[{key, weight, offering_id}]`); at most ONE running per
  tenant (partial unique index). Rules live in `paywall_experiment_save` / `paywall_experiment_set_status` (error
  codes `experiment_*`), mirrored by `dashboard/lib/experiments.ts`; only a draft is editable and a stopped test
  never restarts. Dashboard ▸ Paywall ▸ Experiments (`/api/experiments`).
- **Assignment is the SDK's:** `/config` serves the running experiment as `experiment` (`paywall_experiment_public_get`);
  `config/Experiment.kt` hashes `key:deviceId` (FNV-1a) into the weights and `PayCraft.applySuiteConfig` — the one
  door every config passes through — makes the variant's offering current and drops products only OTHER variants
  sell. A missing offering or no experiment leaves the paywall unchanged.
- **Pre-selected plan (221):** a variant may carry `default_sku` (inside `variants`; checked on save to be an active
  plan its offering sells — `experiment_default_sku_unknown`). It rides on `ExperimentAssignment.defaultSku` (dropped
  when the variant doesn't sell it) and `PayCraftPaywallViewModel` (`initialSelectedPlan` / `applyDefaultPlan`) opens
  on it ahead of `popular_plan_sku` and the workflow's `is_selected_by_default`. The web SDK doesn't apply experiments.
- **Exit offer + design per variant, templates, promote (227):** a variant may also carry `exit_offer` (false = off),
  `exit_offer_coupon_id` (its own exit coupon) and `paywall_template` (branded-stack | minimal | premium | dark); errors
  `experiment_exit_offer_invalid` / `experiment_exit_coupon_unknown` / `experiment_template_unknown`. The SDK applies the
  design in `withExperimentAssigned` (template seed replaces the published tree) and the exit offer via
  `ExitSurveyConfig.forVariant`; `winback` gets `experiment`+`variant` and picks the arm's coupon (`exitOfferCoupon`).
  Results add `offer_views`, `offer_accepts` and `revenue` (catalogue price of what each buyer bought, per currency).
  `paywall_experiment_promote` makes an arm the default (current offering, popular plan, exit offer, template — the
  published tree is unpublished, the draft kept) and stops the test. Dashboard templates: `EXPERIMENT_TEMPLATES` in
  `lib/experiments.ts` (every arm keeps the exit offer on unless the test is about it). Tests:
  `ExperimentVariantOverridesTest`, `__tests__/lib/experiment-templates.test.ts`, `supabase/tests/227_experiment_templates_test.sql`.
- **Results:** every paywall event carries `experiment` + `variant` (`PayCraft.activeExperiment` → `PayCraftEvent` →
  `events` → `paywall_events`); `paywall_experiment_results` counts distinct devices per step, live mode only, inside
  the run window. Tests: `ExperimentAssignmentTest`, `ExperimentDefaultPlanTest`, `supabase/tests/206_paywall_experiments_test.sql`, `221_experiment_default_plan_test.sql`.

## App Store refund requests

- Apple's `CONSUMPTION_REQUEST` (a customer asked for a refund) is answered by `_shared/appstore-consumption.ts` from
  `apple-notification.ts`: Send Consumption Information with only known facts (delivered, subscription period used,
  tenure from `originalPurchaseDate`, the tenant's refund preference), everything else 0 = undeclared.
- Sent only when the tenant turned on `tenants.appstore_consumption_consent` (Apple requires customer consent; default
  off) — Providers ▸ App Store ▸ Refund requests. Every request is logged once per transaction in
  `appstore_consumption_responses` (migration 207). Test: `supabase/functions/__tests__/appstore-consumption.test.ts`.
- Renewal failures, price increases, grace and revocations need no special case: every Apple notification re-fetches
  the status and `appleToCanonical` maps it (`__tests__/store-state-mapping.test.ts` pins each state's access).

## Monthly allowance — metered actions

- A tenant can give each user N free uses of a metered action per calendar month (UTC), e.g. ReelExport's
  `full-edit` (5/month). Migration 189: `entitlement_monthly_allowance` (config) +
  `entitlement_allowance_spends` (the log; "used this month" is a COUNT, never a counter).
- `allowance_spend(device_token, api_key, sku, idempotency_key)` → `pro` | `allowance` | `credit` | `refused`:
  Pro is never metered, then the free uses, then the configured credit-pack balances (`credit_skus`).
  Replays return the original answer; a per-user advisory lock stops two parallel spends taking the
  last free use. `allowance_status` reports used / remaining / credits / `resets_at`.
- Refunds (`allowance_refund`) are service-role only and reach consumers through
  `POST /v1/allowance/refund` with a `pcsk_` key holding `allowance:refund` — a client must never be
  able to claim "your server failed". Configure with `PUT /v1/allowance` (`products:write`).
- **Units + a Pro grant (migration 195)** — for a credits wallet: `allowance_spend_units(token, key, sku, qty, idem)`
  → `{source, quantity, period_units, credit_units}`. `pro_per_month` (NULL = Pro unmetered, the 189 default) gives
  Pro N units a calendar month, spent first; the rest comes from ONE credit balance in the same call; short →
  `refused` with nothing debited. Refund returns both parts. `allowance_status` adds `grant_per_month` /
  `grant_used` / `grant_remaining`. `allowance_spend` (189) is the 1-unit case and still returns text. First
  consumer: ReelExport `credits` (0 free, 300 Pro, packs grant `credits`).
- **A grant per plan (migration 196)** — `plan_grants` JSONB `{ "<plan sku>": units }` on the allowance, set with
  `allowance_set_plan_grants` / `PUT /v1/allowance { plan_grants }`. A Pro caller gets the largest grant among their
  live subscriptions' `plan` values the map lists, else `pro_per_month` (store entitlements carry no plan → fallback).
  NULL map = 195 behaviour. Test `supabase/tests/196_allowance_plan_grants_test.sql`.
- **Subscriber plan change (migration 197 + `subscription-change`)**: `POST /functions/v1/subscription-change?apiKey=`
  `{ token, plan }` moves the caller's live subscription to another plan of the same app — never a second checkout
  (one subscriptions row per email per tenant, so a second checkout double-billed). Stripe: single item's price
  swapped with `proration_behavior=always_invoice`, effective now. Razorpay: `schedule_change_at=cycle_end`
  (mid-cycle proration undocumented); `subscriptions.pending_plan` / `plan_changes_at` carry the switch and
  `subscription_effective_plan()` (read by the 196 grant) applies it when due. Stores → 501. Decisions in
  `subscription-change/change.ts` (deno tests); SQL `supabase/tests/197_subscription_plan_change_test.sql`.

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
