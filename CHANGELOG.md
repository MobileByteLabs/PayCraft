# Changelog

## [2.0.0] - 2026-06-06

### Cloud SaaS launch — paycraft.cloud

PayCraft v2.0 ships `paycraft.cloud` as a managed billing SaaS: configure products, pricing,
paywall templates, and providers from a dashboard — your app code collapses to a single call.
In-code `PayCraft.configure {}` remains fully supported for teams that prefer it.

#### New — Cloud dashboard configuration path

```kotlin
PayCraft.initialize(apiKey = "pk_live_…")  // everything else from paycraft.cloud
```

- **Thin SDK init** — `PayCraft.initialize(apiKey, backend?)`. All config fetched via `/v2/config`
  with offline cache (`SuiteConfig` — products, providers, pricing, paywall, branding, locale).
- **`PayCraftBackend`** — `Cloud` (default), `SelfHosted(supabaseUrl, supabaseAnonKey)`, `Mock` (testing).
- **3 paywall templates** — `Minimal`, `Premium`, `Dark` — selectable in the dashboard, rendered
  client-side from `SuiteConfig.paywall.template`. Custom templates via `PayCraftPaywall(content = …)`.
- **`MobileByteSenseiTheme`** — default paywall theme with PayCraft brand tokens; per-tenant
  override via dashboard.

#### New — Provider bottom sheet + branding

- **`ProviderPicker`** sealed interface — `AutoSkipWhenSingle` (default), `BottomSheet(maxVisible)`,
  `Inline` strategies. Multi-provider tenants see a locale-filtered provider selection sheet.
- **`Branding`** sealed interface — `Attribution` (Free tier, shows "Powered by PayCraft"),
  `None` (Pro+), `Custom(footer)` (Enterprise). Rendered via `BrandingFooter` composable.

#### New — Dashboard

Next.js 14 dashboard at `paycraft.cloud`:

- Onboarding wizard — app creation → provider OAuth → first product → API key
- Product/pricing manager — Subscription, Trial, Lifetime types; per-country pricing
- Paywall designer — live preview with template + theme controls
- Provider management — Stripe Connect OAuth, Razorpay, Paddle; multi-provider ordering
- Analytics — MRR, churn, subscriber growth; per-cohort + A/B experiments
- Team & billing — RBAC (Owner / Admin / Viewer), tier enforcement, upgrade flow
- Audit log — all dashboard actions with actor, timestamp, diff

#### New — Production infrastructure (Phase 13)

- Cloudflare DNS + Vercel deployment with security headers (HSTS, CSP, X-Frame-Options)
- Sentry error tracking (client + server)
- BetterStack uptime monitoring + SLA dashboard
- Postmark transactional emails (6 templates: welcome, team-invite, limit-warn, limit-hit, webhook-fail, sub-expiry)
- Rate limiting policy + GDPR/SOC2 compliance docs
- CI/CD: 3-job deploy pipeline + smoke test workflow

#### New — Server (Phases 1–2)

- 7 new Supabase migrations (028–034): `paycraft_tenants`, `paycraft_api_keys`,
  `paycraft_products`, `paycraft_providers`, `paycraft_paywall_config`, `paycraft_usage_events`,
  `paycraft_team_members`
- 3 new Edge Functions: `/v2/config` (suite config fetch), `/v2/billing` (event ingestion),
  `stripe-connect-oauth` (provider auth flow)

#### New — Self-host Enterprise (Phase 11)

- `PayCraftBackend.SelfHosted(supabaseUrl, supabaseAnonKey)` overload
- `SELF_HOST_GUIDE.md` + Helm chart + Docker Compose stack + license key validation

#### Preserved unchanged

- `PayCraft.configure {}` — fully supported in-code configuration path
- `BillingManager`, `SyncPolicy`, `PayCraftService` engine
- `PayCraftPaywall()` composable signature unchanged
- Webhooks, migrations 014–027 (including trial schema 026/027 from v1.1)
- 17 unit tests + 7 SQL assertions from v1.1 trial support

#### Configuration path comparison

| | In-code | Cloud dashboard |
|---|---|---|
| Config location | Kotlin source | paycraft.cloud |
| SDK call | `PayCraft.configure { … }` | `PayCraft.initialize(apiKey)` |
| Price change | Code change + release | Dashboard edit — live instantly |
| Paywall template | Code | Dashboard |
| Self-host | ✅ native | ✅ `SelfHosted` backend |

Migration guide: [docs/MIGRATION_V2.md](docs/MIGRATION_V2.md)

---

## [1.4.0] - 2026-04-28

### Added
- **Smart sync cache-first billing** — `PayCraftBillingManager` now reads cached `SubscriptionStatus` synchronously in `init`, eliminating the `Loading` flash on app launch. Supabase is only called when the cache is stale or missing.
- **`SyncPolicy`** — tiered sync intervals based on subscription state:
  - Weekly: premium with >7 days to expiry
  - Daily: free users, cancelled subscriptions, or 1-7 days to expiry
  - Hourly: <24 hours to expiry (catches renewals/expirations quickly)
- **`refreshStatus(force: Boolean = false)`** — new parameter on `BillingManager.refreshStatus()`. Default (`false`) respects `SyncPolicy`; pass `true` to always fetch from Supabase (e.g., post-checkout polling).
- **`PayCraftStore` cache methods** — `cacheSubscriptionStatus()`, `getCachedSubscriptionStatus()`, `getLastSyncedAt()`, `clearCache()` with default no-op implementations for backward compatibility.
- **`PayCraftSettingsStore` cache persistence** — cached status stored via `multiplatform-settings` (survives app restarts).
- **`currentTimeMillis()` expect/actual** — KMP time provider for Android, JVM, iOS, macOS, JS, and WasmJS.

### Changed
- `refreshStatus()` default behavior changed from always-fetch to smart sync. This is source-compatible but a **behavioral change**.
- `logOut()` and `revokeCurrentDevice()` now clear the subscription cache.
- `applyPremiumResult()` now writes to cache after every successful Supabase sync.

### Migration Guide
If your app calls `refreshStatus()` after a payment checkout (e.g., returning from Stripe), update to:
```kotlin
billingManager.refreshStatus(force = true)
```
All other call sites (init, ON_RESUME, screen transitions) work correctly with the new smart sync default.

## [1.3.0] - 2026-04-27

### Added
- Device conflict resolution (OAuth Gate 1 + OTP Gate 2)
- `confirmDeviceTransfer()` for explicit user-confirmed transfers
- `OwnershipVerified` billing state with verification method tracking
- Comprehensive `PayCraftLogger` debug logging
