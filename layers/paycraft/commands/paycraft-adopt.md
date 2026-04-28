# /paycraft-adopt — PayCraft Adoption Host

> **MATRIX HOST** — Shows live implementation status, then routes to phase commands.
> Every action is handled by a dedicated phase file. This file owns only the matrix and menu.

---

## ⚠️ STRICTLY ENFORCED: KMP-FIRST — NO PLATFORM-SPECIFIC BILLING CODE

PayCraft is a **Kotlin Multiplatform library**. Every integration MUST target `commonMain`.
The ONLY allowed platform-specific code: `PayCraftPlatform.init()` in `androidMain` / `iosMain`.
Everything else — `PayCraft.configure()`, `PayCraftBanner`, `LifecycleEventEffect` refresh — goes in `commonMain`.
**HARD STOP** on any `subscriptionManager.refreshStatus()` in `Activity.onResume()` or any Activity/AppDelegate.

---

## MEMORY SYSTEM — `.paycraft/memory.json` Schema (M1)

```json
{
  "paycraft_version": "1.1.0",
  "last_run": "2026-04-26T09:35:49Z",
  "env_path": "/path/to/project/.env",
  "env_path_confirmed_by_user": true,
  "koin_module_file": "cmp-navigation/src/commonMain/.../KoinModules.kt",
  "koin_module_line": 42,
  "billing_card_file": "feature/settings/src/commonMain/.../SettingsScreen.kt",
  "billing_card_line": 557,
  "lifecycle_refresh_file": "feature/settings/src/commonMain/.../SettingsScreen.kt",
  "lifecycle_refresh_line": 152,
  "configure_file": "core/network/src/commonMain/.../NetworkModule.kt",
  "deep_link_scheme": "myapp",
  "phases_completed": ["env", "supabase", "oauth", "stripe", "client"],
  "phases_verified": ["supabase", "oauth", "client", "sandbox_e2e", "production_ready"],
  "oauth_status": "COMPLETE",
  "oauth_google_enabled": true,
  "oauth_apple_enabled": true,
  "supabase_project_ref": "mlwfgytjxlqyfxcgpysm",
  "stripe_product_id": "prod_...",
  "stripe_live_product_id": "prod_... (live)",
  "payment_links": {
    "monthly": "https://buy.stripe.com/test_...",
    "yearly": "https://buy.stripe.com/test_..."
  },
  "payment_links_live": {
    "monthly": "https://buy.stripe.com/...",
    "yearly": "https://buy.stripe.com/..."
  }
}
```

**Rules:**
- Written atomically: always write to `.paycraft/memory.json.tmp` then rename (S10)
- Read BEFORE every run — see STEP 0A
- Supplements live scanning (matrix always re-checks live state)
- `.paycraft/backups/` and `.paycraft/exports/` are gitignored (secrets)
- All other `.paycraft/` files are safe to commit

---

## STEP 0A — READ MEMORY + SCHEMA MIGRATION (runs before matrix)

```
MEMORY_PATH = {TARGET_APP_PATH}/.paycraft/memory.json
SCHEMA_PATH = {TARGET_APP_PATH}/.paycraft/schema_version

IF memory.json exists:
  READ + PARSE → populate remembered_context (env_path, koin_module_file, etc.)

  READ SCHEMA_PATH → stored_version
  CURRENT_VERSION = current PayCraft library version
  IF stored_version != CURRENT_VERSION:
    DISPLAY:
      "⚠️  PayCraft version change detected: {stored_version} → {CURRENT_VERSION}"
      "[U] Update memory schema automatically   [S] Skip (keep old schema)"
    IF [U]: update schema, write schema_version, write memory.json

ELSE:
  remembered_context = {} (cold start)
  OUTPUT: "ℹ First run — .paycraft/ will be initialized in Phase 1"
```

---

## STEP 0 — STATUS MATRIX (runs FIRST, every time)

Before executing anything, read memory (STEP 0A above), then scan live state and display this matrix.
Memory-remembered values show `[✓ remembered]` in the matrix:

```
╔══ /paycraft-adopt — Current Implementation Status ════════════════════════════╗
║                                                                                 ║
║  ENVIRONMENT (.env)                                                             ║
║  [✓/✗] PAYCRAFT_SUPABASE_PROJECT_REF  — [value or MISSING]                    ║
║  [✓/✗] PAYCRAFT_SUPABASE_URL          — [value or MISSING]                    ║
║  [✓/✗] PAYCRAFT_SUPABASE_ANON_KEY     — [set/MISSING]                         ║
║  [✓/✗] PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY — [set/MISSING]                     ║
║  [✓/✗] PAYCRAFT_PROVIDER              — [stripe/razorpay/MISSING]              ║
║  [✓/✗] PAYCRAFT_MODE                  — [test/live/MISSING]                    ║
║                                                                                 ║
║  STRIPE TEST                                                                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_SECRET_KEY     — [sk_test_.../MISSING]            ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET — [set/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_LINK_MONTHLY   — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_LINK_QUARTERLY — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_LINK_YEARLY    — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_TEST_PORTAL_URL     — [url/MISSING]                    ║
║                                                                                 ║
║  STRIPE LIVE                                                                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_SECRET_KEY     — [sk_live_.../MISSING]            ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET — [set/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY   — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_LINK_QUARTERLY — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_LINK_YEARLY    — [url/MISSING]                    ║
║  [✓/✗] PAYCRAFT_STRIPE_LIVE_PORTAL_URL     — [url/MISSING]                    ║
║                                                                                 ║
║  SUPABASE                                                                       ║
║  [?] subscriptions table              — [✓ exists / ✗ missing / ? not checked] ║
║  [?] is_premium() RPC                 — [✓ exists / ✗ missing / ? not checked] ║
║  [?] get_subscription() RPC           — [✓ exists / ✗ missing / ? not checked] ║
║  [?] stripe-webhook function              — [✓ ACTIVE / ✗ missing / ? not checked] ║
║  [?] STRIPE_TEST_SECRET_KEY deployed      — [✓ set / ✗ missing / ? not checked]    ║
║  [?] STRIPE_TEST_WEBHOOK_SECRET deployed  — [✓ set / ✗ missing / ? not checked]    ║
║  [?] STRIPE_LIVE_SECRET_KEY deployed      — [✓ set / ✗ missing / ? not checked]    ║
║  [?] STRIPE_LIVE_WEBHOOK_SECRET deployed  — [✓ set / ✗ missing / ? not checked]    ║
║                                                                                 ║
║  CLIENT APP ([target_app_path])                                                 ║
║  [?] PayCraft dependency in Gradle    — [✓ found / ✗ missing / ? not checked]  ║
║  [?] PayCraft.configure() call        — [✓ found / ✗ missing / ? not checked]  ║
║  [?] PayCraftModule in Koin           — [✓ found / ✗ missing / ? not checked]  ║
║  [?] PayCraftBanner in SettingsScreen — [✓ found / ✗ missing / ? not checked]  ║
║  [?] LifecycleEventEffect ON_RESUME   — [✓ found / ✗ missing / ? not checked]  ║
║  [?] iOS cocoapods declared           — [✓ found / ✗ missing / ? not checked]  ║
║                                                                                 ║
║  MEMORY (.paycraft/memory.json)                                                 ║
║  [?] .paycraft/ initialized           — [✓ exists / ✗ not yet]                 ║
║  [?] env_path remembered              — [✓ {path} / ✗ not set]                 ║
║  [?] koin_module_file remembered      — [✓ {file}:{line} / ✗ not set]          ║
║  [?] billing_card_file remembered     — [✓ {file}:{line} / ✗ not set]          ║
║  [?] phases_completed                 — [list or NONE]                          ║
║                                                                                 ║
║  SANDBOX TEST (last run)                                                        ║
║  [?] Sandbox payment completed        — [✓ verified {date} / ✗ not run]        ║
║                                         (source: .paycraft/test_results/       ║
║                                          sandbox_test.json)                    ║
║  [?] Webhook received + DB updated    — [✓ verified / ✗ not run]               ║
║  [?] is_premium() confirmed true      — [✓ verified / ✗ not run]               ║
║                                                                                 ║
║  LIVE MODE                                                                      ║
║  [?] PAYCRAFT_STRIPE_LIVE_SECRET_KEY  — [sk_live_.../MISSING]                  ║
║  [?] PAYCRAFT_STRIPE_LIVE_LINK_*      — [all set / partial / MISSING]          ║
║  [?] Live webhook registered          — [✓ / ✗ / ? not checked]                ║
║  [?] Live E2E test completed          — [✓ / ✗ not run]                        ║
║                                                                                 ║
║  PRODUCTION READINESS (.paycraft/production_ready.json)                         ║
║  [?] All gates passed (PR.1–PR.7)     — [✓ certified {date} / ✗ not run]      ║
║  [?] Certification age                — [✓ recent / ⚠ {N} days ago / ✗ none]  ║
║  [?] Env changed since certification  — [✓ unchanged / ⚠ changed — re-run P]  ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

### HOW TO POPULATE THE MATRIX

**ENV section**: Read {ENV_PATH} — check each PAYCRAFT_* key.
  Show actual value for non-secret keys (URL, REF, PROVIDER, MODE, LINK_*).
  Show `[set]` / `[MISSING]` for secrets (keys containing sk_, whsec_, JWT token patterns).

**SUPABASE section**: Only query if ENV keys present.
  1. POST database/query: `SELECT COUNT(*) FROM information_schema.tables WHERE table_name='subscriptions'`
  2. POST database/query: `SELECT COUNT(*) FROM information_schema.routines WHERE routine_name='is_premium'`
  3. POST database/query: `SELECT COUNT(*) FROM information_schema.routines WHERE routine_name='get_subscription'`
  4. GET `https://api.supabase.com/v1/projects/{ref}/functions` → check stripe-webhook status
  AUTH: Bearer PAYCRAFT_SUPABASE_ACCESS_TOKEN
  If ENV keys missing → show `? not checked` for all.

**CLIENT APP section**: Only scan if target_app_path is known.
  Note: KMP projects are often multi-module — search ALL subdirs, not just src/commonMain.
  1. Glob `**/libs.versions.toml` → grep `paycraft`
  2. Grep `{target_app_path}/**/*.kt` for `PayCraft.configure(`
  3. Grep `{target_app_path}/**/*.kt` for `PayCraftModule`
  4. Grep `{target_app_path}/**/commonMain/**/*.kt` for `PayCraftBanner`
  5. Grep `{target_app_path}/**/commonMain/**/*.kt` for `LifecycleEventEffect`
  6. Grep `{target_app_path}/**/build.gradle.kts` for `kotlinCocoapods`

**MEMORY section**: Read `.paycraft/memory.json` → show remembered_context fields.
**SANDBOX / LIVE TEST section**: Read `.paycraft/test_results/sandbox_test.json` and `live_test.json`.
**PRODUCTION READINESS section**: Read `.paycraft/production_ready.json` if it exists.
  - `certified_at` present → show `[✓ certified {date}]`
  - `certified_at` > 30 days ago → show `[⚠ certified {N} days ago — consider re-running [P]]`
  - Compare env keys to `certified_at` timestamp → if any PAYCRAFT_* key modified after that date → show `[⚠ env changed since certification]`
  - File missing → show `[✗ not run — run [P] before shipping]`

---

## STEP 0C — AUTO-VERIFY AND AUTO-FIX LOOP (runs automatically after matrix)

> **This loop fires on EVERY run. No user selection required.**
> Purpose: verify each gate against the LATEST expected state; auto-fix what can be fixed;
> only stop to ask the user for genuine human-only steps (browser actions, secret values).

```
AUTO_FIX_LOG = []      ← items fixed automatically this run
MANUAL_REQUIRED = []   ← items that need human action
ALREADY_DONE = []      ← items that are correct and up-to-date

VERSION_EXPECTED = current PayCraft schema_version (read from paycraft_root/VERSION or cmp-paycraft/build.gradle.kts)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MATRIX CACHE — Read paycraft-matrix.yaml before slow gates
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MATRIX_PATH = {TARGET_APP_PATH}/.paycraft/paycraft-matrix.yaml
CACHE_TTL_MINUTES = 10

IF MATRIX_PATH exists:
  READ MATRIX_PATH → matrix_state cache

  FOR EACH gate IN [supabase, client, oauth]:
    scanned_at = matrix_state.{gate}.scanned_at
    IF scanned_at IS null:
      cache_age_minutes = null (never scanned → must scan)
    ELSE:
      cache_age_minutes = (now - parse_iso8601(scanned_at)) / 60
      -- Claude: read the ISO8601 timestamp, estimate minutes ago from current time

    IF cache_age_minutes IS null OR cache_age_minutes >= CACHE_TTL_MINUTES:
      GATE_USE_CACHE[gate] = false  ← run live scan, write back to matrix
    ELSE:
      GATE_USE_CACHE[gate] = true   ← use cached state
      OUTPUT: "  ✓ {gate} (cached — {cache_age_minutes}m ago)"

NOTE: ENV gate = file read (fast) — always live, never cached.
NOTE: MEMORY gate = file read — always live, never cached.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATE ENV — Verify ENV keys
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FOR EACH required PAYCRAFT_* key (test-mode set):
  IF key is present and non-empty AND format is correct:
    → ALREADY_DONE: "ENV key {KEY_NAME} ✓"
  IF key is missing or malformed:
    IF key is a URL/REF/PROVIDER/MODE (non-secret, derivable or has default):
      → AUTO_FIX: prompt user inline for value → write to ENV_PATH → re-check
      → AUTO_FIX_LOG: "Wrote {KEY_NAME} to .env"
    IF key is a secret (sk_test_, whsec_, anon key, service_role):
      → MANUAL_REQUIRED: "{KEY_NAME} missing — see [D] Keys guide for steps"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATE SUPABASE — Verify schema is current
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IF GATE_USE_CACHE[supabase] = true:
  USE matrix_state.supabase cached values → skip live Supabase queries
  OUTPUT: "  SUPABASE (cached — {cache_age_minutes}m ago): {migrations_applied} migrations ✓"
  GOTO GATE CLIENT

SKIP this gate if PAYCRAFT_SUPABASE_URL or PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY is missing.

EXPECTED_MIGRATIONS = all .sql files in paycraft_root/server/migrations/ sorted numerically
  (e.g. 001_create_subscriptions.sql, 002_..., 005_device_binding.sql, ...)

APPLIED_MIGRATIONS = query:
  SELECT migration_name FROM supabase_migrations.schema_migrations ORDER BY migration_name
  IF table missing → applied = []

FOR EACH expected migration file:
  migration_id = filename without .sql  (e.g. "005_device_binding")
  IF migration_id in applied:
    → ALREADY_DONE: "Migration {migration_id} ✓"
  ELSE:
    → This migration is MISSING
    → AUTO_FIX: read SQL file content → POST to Supabase REST/rpc or display as instruction
    → Because migrations can't always be applied automatically via REST, present as:
       DISPLAY: "⚡ Auto-applying missing migration: {migration_id}"
       POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/exec_sql  (if exec_sql RPC exists)
       OR DISPLAY: "Manual step required — apply via Supabase dashboard or CLI:"
                   "  supabase db push  OR  paste into SQL editor:"
                   "{SQL content}"
       MARK as MANUAL_REQUIRED if cannot auto-apply

VERIFY RPCs (after migrations):
  FOR EACH expected RPC [is_premium, get_subscription, register_device, check_premium_with_device, check_otp_gate]:
    IF RPC exists in information_schema.routines: ALREADY_DONE
    ELSE: MANUAL_REQUIRED "RPC {name} missing — re-run Phase 2 (migrations include this RPC)"

VERIFY Edge Functions:
  GET https://api.supabase.com/v1/projects/{ref}/functions
  FOR EACH expected function [stripe-webhook, otp-send-hook (if device binding migration applied)]:
    IF function status = "ACTIVE": ALREADY_DONE
    IF function missing:
      → AUTO_FIX_LOG entry + tell user how to deploy:
        DISPLAY: "⚡ Edge Function '{name}' not deployed — auto-deploying..."
        RUN: supabase functions deploy {name} --project-ref {ref}   (if supabase CLI available)
        IF CLI not available: MANUAL_REQUIRED with deploy instructions

VERIFY Edge Function secrets:
  GET https://api.supabase.com/v1/projects/{ref}/secrets
  FOR EACH required secret [STRIPE_TEST_SECRET_KEY, STRIPE_TEST_WEBHOOK_SECRET, STRIPE_LIVE_SECRET_KEY, STRIPE_LIVE_WEBHOOK_SECRET]:
    IF present: ALREADY_DONE
    IF missing:
      → Auto-push from .env value:
        POST https://api.supabase.com/v1/projects/{ref}/secrets  with { name, value } from ENV_PATH
        IF ENV value present → AUTO_FIX_LOG "Pushed {SECRET_NAME} to Edge Function secrets"
        IF ENV value also missing → MANUAL_REQUIRED

-- Write supabase scan results back to matrix cache
IF MATRIX_PATH exists:
  WRITE .paycraft/paycraft-matrix.yaml matrix_state.supabase:
    status: ok/partial/missing
    scanned_at: {now ISO8601}
    migrations_applied: [list]
    migrations_missing: [list]
    edge_functions: {name: status}
    device_id_column: {true if 009_device_id in applied_migrations}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATE CLIENT — Verify KMP integration is current
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IF GATE_USE_CACHE[client] = true:
  USE matrix_state.client cached values → skip live file scans
  OUTPUT: "  CLIENT (cached — {cache_age_minutes}m ago): paycraft={paycraft_version} ✓"
  GOTO GATE OAUTH

SKIP if target_app_path is unknown.

CURRENT_PAYCRAFT_VERSION = read from paycraft_root cmp-paycraft/build.gradle.kts → version field

FOR EACH client check:

  [ ] Dependency version in libs.versions.toml
      Grep **/libs.versions.toml for paycraft version
      IF present AND version == CURRENT_PAYCRAFT_VERSION: ALREADY_DONE
      IF present BUT version != CURRENT_PAYCRAFT_VERSION:
        → AUTO_FIX: Edit libs.versions.toml → update paycraft version to CURRENT_PAYCRAFT_VERSION
        → AUTO_FIX_LOG: "Updated paycraft version {old} → {new} in libs.versions.toml"
      IF missing:
        → AUTO_FIX: Add paycraft = "{version}" to [versions] section + add paycraft dep to [libraries]
        → AUTO_FIX_LOG: "Added paycraft dependency to libs.versions.toml"

  [ ] PayCraft.configure() in commonMain
      Grep **/*.kt for "PayCraft.configure"
      IF found in commonMain path: verify configure block has supabase + provider + plans
        IF all present: ALREADY_DONE
        IF any missing: MANUAL_REQUIRED "PayCraft.configure() block is incomplete — add missing: {list}"
      IF not found: MANUAL_REQUIRED "PayCraft.configure() not found — run Phase 4 to add it"

  [ ] PayCraftModule in Koin
      Grep **/*.kt for "PayCraftModule"
      IF found: ALREADY_DONE
      IF not found: MANUAL_REQUIRED "PayCraftModule not in Koin includes — run Phase 4"

  [ ] PayCraftBanner in UI
      Grep **/commonMain/**/*.kt for "PayCraftBanner"
      IF found: ALREADY_DONE
      IF not found: MANUAL_REQUIRED "PayCraftBanner not in UI — run Phase 4"

  [ ] LifecycleEventEffect ON_RESUME refresh
      Grep **/commonMain/**/*.kt for "LifecycleEventEffect" AND "refreshStatus"
      IF both found: ALREADY_DONE
      IF missing: MANUAL_REQUIRED "LifecycleEventEffect refresh missing — run Phase 4"

  [ ] DeviceConflict UI (if device binding migration applied)
      IF migration 005_device_binding.sql was in APPLIED_MIGRATIONS:
        Grep **/commonMain/**/*.kt for "BillingState.DeviceConflict" OR "DeviceConflict"
        IF found: ALREADY_DONE
        IF not found: MANUAL_REQUIRED "DeviceConflict UI state not handled — needed for device binding"

  [ ] ZERO platform-specific billing code
      Grep **/androidMain/**/*.kt for "PayCraft|BillingManager|refreshStatus"
        excluding PayCraftPlatform.init()
      Grep **/iosMain/**/*.kt for same
      IF matches found (excluding PayCraftPlatform.init()):
        → HARD STOP: "KMP violation — platform-specific billing code found: {files}"
      IF clean: ALREADY_DONE

-- Write client scan results back to matrix cache
IF MATRIX_PATH exists:
  WRITE .paycraft/paycraft-matrix.yaml matrix_state.client:
    status: ok/partial/missing
    scanned_at: {now ISO8601}
    paycraft_version: {found_version or null}
    configure_found, koin_module_found, banner_found,
    lifecycle_refresh_found, device_conflict_ui_found

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATE OAUTH — Verify Google/Apple OAuth provider setup (Phase 2.5)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IF GATE_USE_CACHE[oauth] = true:
  USE matrix_state.oauth cached values → skip live Supabase auth config query
  OUTPUT: "  OAUTH (cached — {cache_age_minutes}m ago): google={google_enabled} apple={apple_enabled}"
  GOTO GATE MEMORY

SKIP this gate if migration 005_device_binding.sql is NOT in APPLIED_MIGRATIONS.
(OAuth is only needed when device binding + conflict resolution is active.)

OAUTH.1 — Supabase Google provider enabled
  IF memory.json oauth_status = "COMPLETE" AND oauth_google_enabled = true:
    → ALREADY_DONE: "Supabase Google OAuth ✓"
  ELSE:
    GET https://api.supabase.com/v1/projects/{ref}/config/auth
    Authorization: Bearer {PAYCRAFT_SUPABASE_ACCESS_TOKEN}
    CHECK: response.external_google_enabled == true
    IF true: ALREADY_DONE + AUTO_FIX: write oauth_google_enabled=true to memory.json
    IF false OR missing:
      → MANUAL_REQUIRED "Google OAuth not enabled in Supabase — run [O] OAuth setup, Step O.1"

OAUTH.2 — Supabase Apple provider enabled (optional — only if app targets iOS)
  IF target_app_path has iOS support (kotlinCocoapods in build.gradle.kts):
    GET https://api.supabase.com/v1/projects/{ref}/config/auth
    CHECK: response.external_apple_enabled == true
    IF true: ALREADY_DONE: "Supabase Apple OAuth ✓"
    IF false OR missing:
      → MANUAL_REQUIRED "Apple OAuth not enabled in Supabase — run [O] OAuth setup, Step O.2"
  ELSE:
    → ALREADY_DONE: "Apple OAuth not required (no iOS target) ✓"

OAUTH.3 — Android Google Sign-In code present in client app
  IF target_app_path known:
    Grep {target_app_path}/**/androidMain/**/*.kt for "PayCraftGoogleSignIn" OR "CredentialManager"
    IF found: ALREADY_DONE: "Android Google Sign-In code ✓"
    IF not found AND Google OAuth is enabled (OAUTH.1 passed):
      → MANUAL_REQUIRED "PayCraftGoogleSignIn.kt missing in androidMain — run [O] OAuth setup, Step O.3"
  ELSE:
    SKIP (target_app_path unknown)

OAUTH.4 — iOS Apple Sign-In code present in client app
  IF target_app_path known AND iOS target exists:
    Grep {target_app_path}/**/iosMain/**/*.kt for "PayCraftAppleSignIn" OR "ASAuthorizationAppleIDProvider"
    IF found: ALREADY_DONE: "iOS Apple Sign-In code ✓"
    IF not found AND Apple OAuth is enabled (OAUTH.2 passed):
      → MANUAL_REQUIRED "PayCraftAppleSignIn.kt missing in iosMain — run [O] OAuth setup, Step O.4"
  ELSE:
    SKIP

OAUTH.5 — OAuth callbacks wired into PayCraftRestore call-site
  IF target_app_path known:
    Grep {target_app_path}/**/commonMain/**/*.kt for "onGoogleSignInClick" OR "onAppleSignInClick"
    IF found: ALREADY_DONE: "OAuth callbacks wired in UI ✓"
    IF not found AND Google OAuth enabled:
      → MANUAL_REQUIRED "onGoogleSignInClick not wired into PayCraftRestore — run [O] OAuth setup, Step O.5"

-- Write oauth scan results back to matrix cache
IF MATRIX_PATH exists:
  WRITE .paycraft/paycraft-matrix.yaml matrix_state.oauth:
    status: ok/partial/missing
    scanned_at: {now ISO8601}
    google_enabled: {bool}
    apple_enabled: {bool}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATE MEMORY — Initialize or migrate .paycraft/memory.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IF .paycraft/ directory does not exist:
  → AUTO_FIX: Create .paycraft/ + write initial memory.json (schema M1)
  → AUTO_FIX_LOG: "Initialized .paycraft/memory.json"

IF memory.json exists AND paycraft_version != CURRENT_PAYCRAFT_VERSION:
  → AUTO_FIX: Migrate memory.json schema to current version
  → AUTO_FIX_LOG: "Migrated memory.json schema {old} → {current}"

SCAN target app for remembered_context values not yet in memory.json:
  IF koin_module_file not in memory AND PayCraftModule found at known file:
    → AUTO_FIX: Write koin_module_file + line to memory.json
  IF billing_card_file not in memory AND PayCraftBanner found at known file:
    → AUTO_FIX: Write billing_card_file + line to memory.json
  IF configure_file not in memory AND PayCraft.configure found at known file:
    → AUTO_FIX: Write configure_file + line to memory.json
  → AUTO_FIX_LOG: "Updated memory.json with discovered file locations"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GATE INCOMPLETE STEPS — Resolve or surface deferred items
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

READ memory.json for any field with value = "INCOMPLETE" or status = "INCOMPLETE":
  FOR EACH incomplete field:
    IF smtp_status = "INCOMPLETE":
      CHECK: Can SMTP now be verified? (ping Brevo API if BREVO_API_KEY in .env)
      IF verifiable AND works: AUTO_FIX: smtp_status = "COMPLETE", write memory.json
                               AUTO_FIX_LOG: "Brevo SMTP auto-verified via API ping"
      ELSE: MANUAL_REQUIRED "Brevo SMTP still pending — must complete Step 2.14 to unblock Production Ready gate"

    IF otp_hook_status = "INCOMPLETE":
      CHECK: Supabase Auth Hook — query hooks API if available
      IF hook now wired: AUTO_FIX: otp_hook_status = "COMPLETE"
                         AUTO_FIX_LOG: "Auth Hook auto-verified as wired"
      ELSE: MANUAL_REQUIRED "Supabase Auth Hook still pending — must complete Step 2.15"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
POST-LOOP: Display auto-verify summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IF AUTO_FIX_LOG is non-empty:
  DISPLAY:
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    "⚡ Auto-fixed this run:"
    FOR EACH entry in AUTO_FIX_LOG:
      "  ✓ {entry}"
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

IF MANUAL_REQUIRED is non-empty:
  DISPLAY:
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    "⚠️  Human action required ({count} item(s)):"
    FOR EACH item in MANUAL_REQUIRED (ordered by phase):
      "  ✗ {item}"
    ""
    "These items cannot be automated. See menu below for fix options."
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

IF MANUAL_REQUIRED is empty AND ALREADY_DONE covers all gates:
  DISPLAY:
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    "✅ All gates verified — PayCraft is fully integrated and up-to-date."
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

RE-RENDER the status matrix with updated state (reflects all auto-fixes applied this run).

WRITE memory.json: last_run = now, update phases_verified list.
```

After auto-verify loop completes, display action menu:

```
╔══ What would you like to do? ══════════════════════════════════════════════════╗
║                                                                                 ║
║  [A] Run full setup      — Phases 1→5 (skip phases already showing all ✓)     ║
║  [B] Test sandbox        — API + device logcat, IS_TEST_MODE=true (Phase 5B)   ║
║  [C] Test live           — Real card + device logcat, IS_TEST_MODE=false (5C)  ║
║  [D] Keys guide          — Step-by-step: how to get every key/secret           ║
║  [E] Verify only         — Re-run Phase 5 API checks (no writes)               ║
║  [F] Fix specific phase  — Pick a phase to re-run                              ║
║  [M] Device management   — Look up / restore / transfer / revoke devices       ║
║  [O] OAuth setup         — Configure Google/Apple Sign-In (Phase 2.5)          ║
║  [P] Production ready    — Run all 7 gates, certify, save to .paycraft/        ║
║  [T] Test scenarios      — 15-scenario matrix: purchase/restore/conflict/neg   ║
║  [X] Clean up test data  — Delete mode='test' rows from subscriptions table    ║
║  [Q] Quit                                                                       ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

**Routes:**
- [A] → STEP 0B bootstrap → load and run Phase 1 → 2 → 2.5 → 3 → 4 → 5 in sequence (smart-skip complete phases)
- [B] → load `layers/paycraft/commands/paycraft-adopt-sandbox.md` → run Phase 5B
- [C] → load `layers/paycraft/commands/paycraft-adopt-live.md` → run Phase 5C
- [D] → load `layers/paycraft/commands/paycraft-adopt-keys.md` → display keys guide
- [E] → load `layers/paycraft/commands/paycraft-adopt-verify.md` → run Phase 5
- [F] → ask which phase (1–5) → load that file → run it
- [M] → inline device management menu (see STEP M below)
- [O] → load `layers/paycraft/commands/paycraft-adopt-oauth.md` → run OAuth setup (Phase 2.5)
- [P] → load `layers/paycraft/commands/paycraft-adopt-production.md` → run production readiness check
- [T] → load `layers/paycraft/commands/paycraft-adopt-scenarios.md` → run Phase 5T (scenario matrix)
- [X] → inline cleanup: query count WHERE mode='test', confirm, DELETE WHERE mode='test', show result
- [Q] → exit

**[X] Clean up test data — inline logic:**
```
1. GET {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?mode=eq.test&select=email,plan,updated_at
   Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}

2. IF count = 0:
     DISPLAY: "✓ No test subscriptions found — table is clean."
     → return to menu

3. DISPLAY table of test rows (email, plan, updated_at)
   DISPLAY:
   "⚠️  Found [N] test subscription(s) with mode='test'."
   "These were created using sk_test_ Stripe keys."
   "Deleting removes them from DB but NOT from Stripe Dashboard."
   ""
   "[D] Delete all [N] test rows   [K] Keep (cancel)"

4. IF [D]:
     DELETE {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?mode=eq.test
     Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
     Prefer: return=minimal

     VERIFY: GET count again → expect 0
     DISPLAY: "✓ Deleted [N] test row(s). Table now has [M] live row(s)."

5. Re-render status matrix with updated state.
```

---

## STEP M — Device Management (inline, triggered by [M])

> Admin tool for manual subscription + device operations.
> Uses PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY for all queries (bypasses RLS).
> All destructive actions require explicit confirmation.

```
DISPLAY device management sub-menu:

╔══ Device Management ═══════════════════════════════════════════════════════════╗
║                                                                                 ║
║  [1] Look up user           — Query subscription + devices by email            ║
║  [2] Manually register device — Force-register a device for a user             ║
║  [3] Restore subscription   — Mark subscription active / fix status            ║
║  [4] Transfer to device     — Move subscription from device A to device B      ║
║  [5] Revoke device          — Deactivate a specific device token               ║
║  [6] List all devices       — Show all registered devices for an email         ║
║  [B] Back                   — Return to main menu                              ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

### [M1] Look up user

```
ASK: "Email address to look up:"
INPUT: email

QUERY subscriptions:
  GET {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions
      ?email=eq.{email}&select=*
      Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}

QUERY devices:
  GET {PAYCRAFT_SUPABASE_URL}/rest/v1/registered_devices
      ?email=eq.{email}&select=*&order=last_seen.desc
      Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}

DISPLAY:
  "── Subscription ─────────────────────────────────────────────"
  IF subscription found:
    "  email:    {email}"
    "  plan:     {plan}"
    "  status:   {status}"
    "  provider: {provider}"
    "  mode:     {mode}"
    "  expires:  {current_period_end}"
  ELSE:
    "  No subscription found for {email}"

  "── Devices ──────────────────────────────────────────────────"
  FOR EACH device:
    "  [{token_prefix}]  {device_name}  ({platform})  last seen: {last_seen}"
    "    status: {ACTIVE|PENDING|REVOKED}"
  IF no devices:
    "  No devices registered for this email"
```

### [M2] Manually register device

```
Use case: app is on a new device, user cannot sign in via OAuth or OTP.
Admin verifies identity externally (e.g. purchase receipt, ID check) then registers manually.

ASK: "Email address:"
ASK: "Device name (e.g. 'iPhone 15 Pro — Rajan'):"
ASK: "Platform (android | ios | web):"
ASK: "Stripe mode (test | live):" [default: live]

ACTION: Call Supabase RPC register_device with p_force=true (bypasses conflict check)

POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/register_device
  apikey: {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
  Body: {
    "p_email": "{email}",
    "p_platform": "{platform}",
    "p_device_name": "{device_name}",
    "p_mode": "{mode}",
    "p_force": true
  }

IF success:
  DISPLAY: "✓ Device registered."
           "  device_token: {token}"
           "  Share this token with the user — they enter it in the app via 'Restore with token'."
           ""
           "  ⚠️  IMPORTANT: If another device was active, it has been REVOKED."

IF fail:
  DISPLAY error + suggest [M1] to check current state.
```

### [M3] Restore subscription

```
Use case: Stripe webhook missed an event, subscription shows expired in DB but is active in Stripe.

ASK: "Email address:"

QUERY Stripe (using PAYCRAFT_STRIPE_LIVE_SECRET_KEY):
  GET https://api.stripe.com/v1/customers?email={email}&limit=1
  Authorization: Bearer {PAYCRAFT_STRIPE_LIVE_SECRET_KEY}

  IF customer found → GET subscriptions for customer
  → find active/trialing subscription

DISPLAY current DB status vs Stripe status.
DISPLAY:
  "── Stripe (source of truth) ──"
  "  status:     {stripe_status}"
  "  plan:       {stripe_plan_name}"
  "  expires:    {stripe_period_end}"
  "── Supabase (current DB) ─────"
  "  status:     {db_status}"
  "  expires:    {db_period_end}"

IF mismatch:
  "[S] Sync DB to match Stripe   [K] Keep as-is"
  IF [S]:
    PATCH {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?email=eq.{email}
      Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
      Body: {
        "status": "{stripe_status}",
        "plan": "{stripe_plan}",
        "current_period_end": "{stripe_period_end}",
        "cancel_at_period_end": {stripe_cancel_at_period_end}
      }
    DISPLAY: "✓ Subscription synced to match Stripe."
ELSE:
  DISPLAY: "✓ DB already matches Stripe — no action needed."
```

### [M4] Transfer subscription to device

```
Use case: admin manually transfers an active subscription from device A to device B.

ASK: "Email address:"
ASK: "Token to ACTIVATE (device B — the target):"
     "  (Get this from [M1] list or [M2] register)"

CONFIRM:
  "⚠️  This will REVOKE all other active device tokens for {email}."
  "    Only device [{token_prefix}] will be active."
  "[Y] Confirm transfer   [N] Cancel"

IF [Y]:
  POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/transfer_to_device
    apikey: {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
    Body: {
      "p_email": "{email}",
      "p_new_token": "{token}",
      "p_mode": "live"
    }

  IF transferred = true:
    DISPLAY: "✓ Transfer complete. Device [{token_prefix}] is now active."
  ELSE:
    DISPLAY: "✗ Transfer failed — token may be invalid or already active."
```

### [M5] Revoke device

```
ASK: "Email address:"
Run [M1] first to list devices → user picks which token to revoke.

CONFIRM:
  "⚠️  Revoking [{device_name}] — the user will lose access on that device."
  "[Y] Revoke   [N] Cancel"

IF [Y]:
  POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/revoke_device
    apikey: {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
    Body: {
      "p_email": "{email}",
      "p_device_token": "{token}",
      "p_mode": "live"
    }

  DISPLAY: "✓ Device [{device_name}] revoked."
```

### [M6] List all devices

```
Same as [M1] but shows ONLY devices table, no subscription query.
Useful for quick device audit.

ASK: "Email address (or 'all' to list latest 50 across all users):"

IF email != 'all':
  GET registered_devices?email=eq.{email}&select=*&order=last_seen.desc

IF 'all':
  GET registered_devices?select=email,device_name,platform,status,last_seen
      &order=last_seen.desc&limit=50

DISPLAY as table with columns: email | device | platform | status | last seen
```

After each [M] sub-action completes → re-show device management sub-menu (loop until [B]).

---

## STEP 0B — BOOTSTRAP (auto-resolve paths before any phase)

### Resolve PAYCRAFT_ROOT

```
FRAMEWORK_ROOT = working directory of Claude Code session
STANDARD_LOCATION = {FRAMEWORK_ROOT}/workspaces/mbs/PayCraft

CHECK: {STANDARD_LOCATION}/server/migrations/001_create_subscriptions.sql exists?
IF YES: paycraft_root = {STANDARD_LOCATION}
IF NOT:
  CHECK: {FRAMEWORK_ROOT}/.env → PAYCRAFT_ROOT key
  IF SET AND valid: paycraft_root = {PAYCRAFT_ROOT value}
  ELSE:
    DISPLAY options: [1] Clone  [2] Enter path
    IF [1]: git clone https://github.com/mobilebytelabs/paycraft {FRAMEWORK_ROOT}/workspaces/mbs/PayCraft
    IF [2]: ASK path → validate migrations/ exists
OUTPUT: "✓ PayCraft: {paycraft_root}"
```

### Resolve TARGET_APP from session context

```
READ: {FRAMEWORK_ROOT}/.claude-runtime/scratchpad/SESSION_CONTEXT_*.md (most recent)
EXTRACT: active_project field (e.g. "mbs/reels-downloader")
DERIVE: target_app_path = {FRAMEWORK_ROOT}/workspaces/{active_project}/source/{project_name}/
CHECK: contains libs.versions.toml or build.gradle.kts?
IF YES: confirm with user "[Y] Use this / [N] Different app"
IF NOT FOUND: ASK for path → validate → resolve

OUTPUT: "✓ Target app: {target_app_path}"
```

### Derive ENV_PATH

```
IF target_app_path contains "/source/":
  ENV_PATH = everything before "/source/" + "/.env"
ELSE:
  ENV_PATH = target_app_path + "/.env"

IF not exists: create with PAYCRAFT_* template
ELSE IF missing PAYCRAFT_PROVIDER=: append PAYCRAFT_* block

OUTPUT: "✓ .env: {ENV_PATH}"
```

After paths resolved → run STEP 0 STATUS MATRIX → display action menu.

---

## Phase Runtime Files

| Phase | File | Purpose |
|-------|------|---------|
| Phase 1 | `layers/paycraft/commands/paycraft-adopt-env.md` | ENV bootstrap + key validation |
| Phase 2 | `layers/paycraft/commands/paycraft-adopt-supabase.md` | Supabase migrations + webhook |
| Phase 2.5 | `layers/paycraft/commands/paycraft-adopt-oauth.md` | Google/Apple OAuth provider setup (device conflict Gate 1) |
| Phase 3 (Stripe) | `layers/paycraft/commands/paycraft-adopt-stripe.md` | Stripe products + payment links |
| Phase 3B (Razorpay) | `layers/paycraft/commands/paycraft-adopt-razorpay.md` | Razorpay payment links |
| Phase 4 | `layers/paycraft/commands/paycraft-adopt-client.md` | KMP client integration |
| Phase 5 | `layers/paycraft/commands/paycraft-adopt-verify.md` | E2E API verification |
| Phase 5B | `layers/paycraft/commands/paycraft-adopt-sandbox.md` | Sandbox test (test card + device logs) |
| Phase 5C | `layers/paycraft/commands/paycraft-adopt-live.md` | Live test (real card + device logs) |
| Keys guide | `layers/paycraft/commands/paycraft-adopt-keys.md` | How to get every key |
| Production | `layers/paycraft/commands/paycraft-adopt-production.md` | 7-gate production readiness check + certification |

### Phase progress display (during [A] full setup)

```
╔══ /paycraft-adopt ════════════════════════════════════════╗
║  Phase 1   ENV Bootstrap      [✓ Complete]                  ║
║  Phase 2   Supabase Setup     [⏳ Running: Step 2.3/9]      ║
║  Phase 2.5 OAuth Setup        [⬜ Pending]                  ║
║  Phase 3   Stripe Setup       [⬜ Pending]                  ║
║  Phase 4   Client Integration [⬜ Pending]                  ║
║  Phase 5   Verification       [⬜ Pending]                  ║
║  Phase 5B  Sandbox Test       [⬜ Pending]                  ║
║  Phase 5C  Live Test          [⬜ Pending]                  ║
║  Phase P   Production Ready   [⬜ Pending]                  ║
╚══════════════════════════════════════════════════════════╝
```

### Smart skip (auto-verify informed)

The STEP 0C AUTO-VERIFY LOOP replaces manual smart-skip. On every run:
- Gates that are correct and up-to-date → automatically marked ✓ (no prompt)
- Gates that are stale or wrong → automatically fixed or flagged for user
- Only genuinely manual steps (browser actions, secret values) → surfaced to user

For [A] full setup, after auto-verify loop:
- Phases where all gates are already in ALREADY_DONE list → skip silently
- Phases with items in MANUAL_REQUIRED → run that phase interactively
- Phases with items in AUTO_FIX_LOG → verify fix was applied, mark complete

### Progress file (resumption)

```
PROGRESS_FILE = {target_app_path}/.paycraft/setup_progress.json
WRITE after each phase: { "completed_phases": [...], "target_app": "...", "last_updated": "..." }
ON START if exists: "[R] Resume from Phase [N]  [S] Start over  [Q] Quit"
```

---

## Enforcement Rules (STRICTLY ENFORCED — NO EXCEPTIONS)

1. **STRICT SEQUENCE**: Phase 1→2→2.5→3→4→5→5B→5C→P. Phase 2.5 (OAuth) runs after Supabase migrations — device binding must be deployed before OAuth makes sense. Phase 5C requires 5B PASS first. Phase P requires 5B + 5C PASS. No re-ordering. No jumping ahead. No exceptions.
2. **VERIFY AFTER EVERY ACTION**: Every API call, migration, deploy, file write = immediate verify. Fail = HARD STOP. No proceeding on unverified state.
3. **KMP-FIRST**: Zero platform-specific billing code. All PayCraft calls in `commonMain`. Violation = HARD STOP at Phase 5 KMP audit.
4. **USER ACTION GATES**: Browser steps → numbered checklist + exact URL → PAUSE → user confirms → verify result. Never auto-proceed past a user gate.
5. **TEST BEFORE LIVE**: Phase 5B (sandbox) MUST PASS before Phase 3B live setup or Phase 5C. HARD STOP if attempted out of order.
6. **HARD STOP FORMAT**:
   ```
   ✗ HARD STOP — [step] failed
   Reason: [exact error]
   Fix   : [numbered steps]
   Run this step again after fixing.
   ```
7. **PHASE CHECKPOINTS**: Summary at end of every phase. User explicitly confirms [Y] before next phase starts. [Q] saves state and stops — it does NOT skip or bypass the phase.
8. **NO SKIP PERMITTED**: No phase, step, or gate may be skipped unless all checks for that phase already show ✓ in the live status matrix (matrix re-scanned at start of every run). "Smart skip" = skip re-running a phase already fully verified — never skip unverified work.
9. **DEFERRED ≠ DONE**: Manual browser steps (Brevo SMTP, Auth Hook wiring, webhook endpoint creation) may be deferred with [D] Defer, but are written to memory.json as `status: "INCOMPLETE"`. The status matrix shows them as ⚠ PENDING. The Production Ready gate [P] HARD STOPs until all deferred steps are resolved.
10. **PHASE GATE SEQUENCE LOCK**: Phase N cannot start if Phase N-1 contains any step with `status: "INCOMPLETE"` in memory.json. Display: `⛔ Phase [N-1] has incomplete steps. Resolve them first via [F] Fix specific phase.`
11. **CHECKPOINT CONFIRMATION IS MANDATORY**: At every phase checkpoint [Y] is required to proceed. Silence = stop. There is no default-proceed. Auto-advancing to the next phase without explicit [Y] is a violation.
12. **NO INLINE BYPASS**: Commenting out, modifying, or working around any HARD STOP, pre-flight check, post-phase verification, or enforcement rule is a violation. Every check runs every time.
13. **AUTO-VERIFY LOOP IS MANDATORY**: STEP 0C runs on EVERY invocation of `/paycraft-adopt`, immediately after the status matrix. It is NOT optional. Every gate is verified against the LATEST expected state (current PayCraft version migrations, current library version). Stale implementations are detected and auto-fixed. The loop cannot be skipped, suppressed, or replaced by memory.json cache alone. Memory.json supplements live scanning — it does not replace it.
