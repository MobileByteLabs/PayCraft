# Real-time analytics — design

**Why.** When a release ships, the owner must see its effect within minutes, not days: per app version, per
country, across the purchase funnel AND the identity flows (sign-in, restore, device limit). Today events carry
no app version, 99% have no country, and restore / sign-in failure / device transfer emit nothing.

**Approach (chosen).** PayCraft is the one pipeline; three views read it: (a) a dashboard **Live** page,
(b) GA4 Realtime through the existing `PayCraft.analyticsListener` forwarding, (c) **alerts** from the existing
attempt-alerts engine plus a new Telegram channel. Rejected: Firebase-first (sampled, per-app, outside PayCraft);
third-party (PostHog/Sentry — extra vendor for what PayCraft + Firebase cover). Crashes stay in Firebase
Crashlytics (velocity alerts switched on in the Firebase console — manual).

## Contract (every part builds against these exact names)

### Event fields (SDK → `events` function → `paywall_events`)
| field | wire key | type / limit | source |
|---|---|---|---|
| app version name | `app_version` | text ≤ 40 | Android `PackageInfo.versionName`, iOS `CFBundleShortVersionString`, desktop/web: `PayCraft.initialize(appVersion=…)` else null |
| app build | `app_build` | int ≥ 0 | Android `longVersionCode`, iOS `CFBundleVersion` (parsed int, else null) |
| OS version | `os_version` | text ≤ 20 | Android `Build.VERSION.RELEASE`, iOS `UIDevice.systemVersion`, else null |

All three also go into `PayCraftEvent.params()` (GA4) as `app_version`, `app_build`, `os_version`.

### New event names (catalog `PayCraftEventName`, step in parentheses)
| name | step | `reason` values |
|---|---|---|
| `paycraft_restore_result` | `restore` | `found` · `not_found` · `failed` |
| `paycraft_sign_in_fail` | `sign_in` | `cancelled` · `rejected` · `network` · `not_configured` · `unknown` (`provider` = google/apple) |
| `paycraft_device_transfer` | `device_limit` | `done` · `failed` |
| `paycraft_offer_decline` | `offer` | — |

(Reuse existing `PayCraftStep` values where they exist; add `restore` if missing.)

### Country
The `paycraft-edge` Worker sets `x-paycraft-country` = `request.cf.country` (ISO-2, uppercased) on the upstream
request and DROPS any client-supplied `x-paycraft-country`. `_shared/geo.ts` reads `x-paycraft-country` FIRST,
then the existing headers. Server-side only — fixes every installed app version.

### Database (migration 223 — server)
- `paywall_events` + `app_version TEXT (≤40)`, `app_build INT (≥0)`, `os_version TEXT (≤20)`; index
  `(tenant_id, app_version, occurred_at DESC)`.
- `paywall_live_minutes(p_tenant uuid, p_since timestamptz, p_mode text)` → rows
  `(minute timestamptz, name text, app_version text, events int, devices int)` — per-minute counts.
- `paywall_version_compare(p_tenant uuid, p_since timestamptz, p_mode text)` → per `app_version`:
  `devices, paywall_views, purchases, purchase_rate, sign_in_views, sign_in_completes, sign_in_fails,
  restores_found, restores_not_found, device_limit_views, device_transfers, first_seen, last_seen`.
- Realtime: `paywall_events` added to `supabase_realtime` publication; RLS lets a tenant member SELECT only
  their tenant's rows (dashboard subscribes filtered by `tenant_id`).

### Alerts (migration 224 — alerts)
New kinds evaluated by `attempt-alerts` (every 5 min, existing 24 h dedupe):
- `release_regression` — newest `app_version` (≥ 30 paywall-view devices) has purchase rate < 50% of the previous
  version's, OR sign-in fail share > 2× previous.
- `sign_in_failing` — ≥ 5 `paycraft_sign_in_fail` and fail share > 30% in the last 60 min.
- `paywall_silent` — 0 `paycraft_paywall_view` in the last 60 min while the prior 7-day same-hour mean ≥ 5.
Telegram channel: `tenant_alert_channels` + `telegram_bot_token_enc BYTEA`, `telegram_chat_id TEXT` (pgcrypto,
same as Slack); sender `sendMessage`; dashboard ▸ Alerts settings gains the two fields.

### Live page (dashboard `/live`)
SPA route. Top: counters for the last 60 min (paywall views, purchases, sign-ins ok/failed, restores
found/not found, device-limit views) with a version filter + country filter. Middle: version comparison table
(from `paywall_version_compare`, newest first, deltas vs previous version). Bottom: live event stream
(Supabase Realtime INSERTs on `paywall_events`, newest first, 200 kept). Per-minute sparkline from
`paywall_live_minutes`, refreshed every 60 s.

## Non-goals
No crash reporting in PayCraft. No personal data in events (existing PII gate applies to the new fields —
versions and OS are not personal). No change to purchase logic.
