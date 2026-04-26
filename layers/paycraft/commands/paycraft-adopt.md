# /paycraft-adopt — End-to-End PayCraft Adoption Command

> **ORCHESTRATOR** — Runs all phases in strict sequence with inline verification after every action.
> Never skip. Never defer. Never use judgment to bypass a step.

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
  "phases_completed": ["env", "supabase", "stripe", "client"],
  "phases_verified": ["supabase", "client", "sandbox_e2e"],
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

## STEP 0A — READ MEMORY + SCHEMA MIGRATION (M2/M4, runs before matrix)

```
MEMORY_PATH = {TARGET_APP_PATH}/.paycraft/memory.json
SCHEMA_PATH = {TARGET_APP_PATH}/.paycraft/schema_version

IF memory.json exists:
  READ + PARSE → populate remembered_context (env_path, koin_module_file, etc.)

  --- Schema migration check (M4) ---
  READ SCHEMA_PATH → stored_version (e.g. "1.0.0")
  CURRENT_VERSION = current PayCraft library version
  IF stored_version != CURRENT_VERSION:
    DISPLAY:
      "⚠️  PayCraft version change detected: {stored_version} → {CURRENT_VERSION}"
      "Memory was created with an older version."
      "[U] Update memory schema automatically   [S] Skip (keep old schema)"
    IF [U]: update schema, write schema_version, write memory.json
    IF [S]: continue with old schema (may have missing fields)

ELSE:
  remembered_context = {} (cold start — first run)
  OUTPUT: "ℹ First run — .paycraft/ will be initialized in Phase 1"
```

---

## STEP 0 — STATUS MATRIX (runs FIRST, every time)

Before executing anything, read memory (STEP 0A above), then scan live state and display this matrix.
Memory-remembered values show `[✓ remembered]` in the matrix (M9):

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
║  [✓/✗] PAYCRAFT_STRIPE_TEST_SECRET_KEY — [sk_test_.../MISSING]                ║
║  [✓/✗] PAYCRAFT_STRIPE_LINK_MONTHLY   — [url/MISSING]                         ║
║  [✓/✗] PAYCRAFT_STRIPE_LINK_QUARTERLY — [url/MISSING]                         ║
║  [✓/✗] PAYCRAFT_STRIPE_LINK_YEARLY    — [url/MISSING]                         ║
║  [✓/✗] PAYCRAFT_STRIPE_WEBHOOK_SECRET — [set/MISSING]                         ║
║  [✓/✗] PAYCRAFT_STRIPE_PORTAL_URL     — [url/MISSING]                         ║
║                                                                                 ║
║  SUPABASE                                                                       ║
║  [?] subscriptions table              — [✓ exists / ✗ missing / ? not checked] ║
║  [?] is_premium() RPC                 — [✓ exists / ✗ missing / ? not checked] ║
║  [?] get_subscription() RPC           — [✓ exists / ✗ missing / ? not checked] ║
║  [?] stripe-webhook function          — [✓ ACTIVE / ✗ missing / ? not checked] ║
║  [?] STRIPE_WEBHOOK_SECRET secret     — [✓ set / ✗ missing / ? not checked]    ║
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
  If target_app_path unknown → show `? not checked`.

**MEMORY section**: Read `.paycraft/memory.json` → show remembered_context fields.
  If file does not exist → all show `✗ not yet`.

**SANDBOX / LIVE TEST section**: Read `.paycraft/test_results/sandbox_test.json` and `.paycraft/test_results/live_test.json` if they exist.
  Show timestamp from `timestamp` field if present.

After matrix, display action menu:

```
╔══ What would you like to do? ══════════════════════════════════════════════════╗
║                                                                                 ║
║  [A] Run full setup      — Phases 1→5 (skip phases already showing all ✓)     ║
║  [B] Test sandbox        — E2E test with Stripe test card (Phase 5B)           ║
║  [C] Test live           — E2E test with real card + real keys (Phase 5C)      ║
║  [D] Get keys guide      — Step-by-step: how to get every key/secret (Phase 6) ║
║  [E] Verify only         — Re-run Phase 5 API checks (no writes)               ║
║  [F] Fix specific phase  — Pick a phase to re-run                              ║
║  [Q] Quit                                                                       ║
╚═════════════════════════════════════════════════════════════════════════════════╝
```

Routes:
- [A] → STEP 0B bootstrap then Phase 1–5 (smart-skip complete phases)
- [B] → PHASE 5B (sandbox E2E test)
- [C] → PHASE 5C (live E2E test — requires live keys)
- [D] → PHASE 6 (real keys guide)
- [E] → load paycraft-adopt-verify.md → run Phase 5
- [F] → ask which phase (1–5) → load that file → run it
- [Q] → stop

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

## PHASE 1–5 — Setup Phases

Load each phase file when entering that phase:

| Phase | File |
|-------|------|
| Phase 1 | `layers/paycraft/commands/paycraft-adopt-env.md` |
| Phase 2 | `layers/paycraft/commands/paycraft-adopt-supabase.md` |
| Phase 3 (Stripe) | `layers/paycraft/commands/paycraft-adopt-stripe.md` |
| Phase 3B (Razorpay) | `layers/paycraft/commands/paycraft-adopt-razorpay.md` |
| Phase 4 | `layers/paycraft/commands/paycraft-adopt-client.md` |
| Phase 5 | `layers/paycraft/commands/paycraft-adopt-verify.md` |

### Phase progress display

```
╔══ /paycraft-adopt ════════════════════════════════════════╗
║  Phase 1 ENV Bootstrap      [✓ Complete]                  ║
║  Phase 2 Supabase Setup     [⏳ Running: Step 2.3/9]      ║
║  Phase 3 Stripe Setup       [⬜ Pending]                  ║
║  Phase 4 Client Integration [⬜ Pending]                  ║
║  Phase 5 Verification       [⬜ Pending]                  ║
║  Phase 5B Sandbox Test      [⬜ Pending]                  ║
║  Phase 5C Live Test         [⬜ Pending]                  ║
╚══════════════════════════════════════════════════════════╝
```

### Smart skip (matrix-informed)

If matrix shows all ✓ for a phase:
```
"Phase 2 (Supabase) appears complete — all checks pass."
"[S] Skip   [R] Re-run anyway"
```

### Progress file (resumption)

```
PROGRESS_FILE = {paycraft_root}/.paycraft/setup_progress.json
WRITE after each phase: { "completed_phases": [...], "target_app": "...", "last_updated": "..." }
ON START if exists: "[R] Resume from Phase [N]  [S] Start over  [Q] Quit"
```

---

## PHASE 5B — Sandbox E2E Test

> Option [B] in the menu. Tests complete payment flow with Stripe test card.
> No real money. Verifies: checkout → webhook → DB → is_premium() → app state.

### Prerequisites

Read .env → must be ✓:
- `PAYCRAFT_STRIPE_TEST_SECRET_KEY` starts with `sk_test_`
- `PAYCRAFT_STRIPE_WEBHOOK_SECRET` starts with `whsec_`
- At least one `PAYCRAFT_STRIPE_LINK_*` non-empty
- `PAYCRAFT_SUPABASE_URL` + `PAYCRAFT_SUPABASE_ANON_KEY` + `PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY` set

IF missing: "Run Phase 1–3 first." → STOP

### STEP 5B.1 — Display test credentials + payment links

```
DISPLAY:
╔══ Stripe Sandbox Test Card ══════════════════════════════════╗
║                                                               ║
║  Card Number : 4242 4242 4242 4242                           ║
║  Expiry      : Any future date  (e.g. 12/28)                 ║
║  CVC         : Any 3 digits     (e.g. 123)                   ║
║  Name        : Any name                                       ║
║  Email       : Use YOUR real email (stored in DB)             ║
║  Address     : Any  (e.g. 1 Test St, New York, NY 10001)     ║
║                                                               ║
║  Other test scenarios:                                        ║
║  Payment declined   : 4000 0000 0000 0002                    ║
║  Insufficient funds : 4000 0000 0000 9995                    ║
║  3D Secure required : 4000 0025 0000 3155                    ║
╚═══════════════════════════════════════════════════════════════╝

Payment links (open in browser or on device):
  Monthly    : [PAYCRAFT_STRIPE_LINK_MONTHLY]
  Quarterly  : [PAYCRAFT_STRIPE_LINK_QUARTERLY]
  Semiannual : [PAYCRAFT_STRIPE_LINK_SEMIANNUAL]
  Yearly     : [PAYCRAFT_STRIPE_LINK_YEARLY]

"Complete the Monthly payment now. Use your real email address."
"After payment succeeds, return here and press [C]."
""
"[C] Payment done — verify now   [S] Skip   [Q] Quit"
```

Wait for [C], [S], or [Q].

### STEP 5B.2 — Ask email used in payment

```
ASK: "What email did you enter during checkout?"
STORE: test_email = entered email
```

### STEP 5B.3 — Poll DB for webhook delivery (30-second timeout)

```
POLL every 3 seconds for up to 30 seconds:
  GET {PAYCRAFT_SUPABASE_URL}/rest/v1/subscriptions?email=eq.[test_email]
      Header: apikey: {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}
              Authorization: Bearer {PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY}

  IF response non-empty AND status = "active": STOP → webhook received ✓

IF timeout (30s):
  DISPLAY:
    "✗ Webhook not received after 30 seconds."
    ""
    "Troubleshoot:"
    "  1. Stripe Dashboard (Test mode) → Developers → Webhooks → Recent Deliveries"
    "     → Find the delivery → check for errors"
    "  2. Supabase function logs:"
    "     supabase functions logs stripe-webhook --project-ref [ref]"
    "  3. Confirm STRIPE_WEBHOOK_SECRET in Supabase secrets matches"
    "     the 'Signing secret' shown in Stripe Dashboard → Webhooks → [endpoint]"
    "  4. Confirm payment succeeded:"
    "     https://dashboard.stripe.com/test/payments"
    ""
    "[R] Retry (30s)   [M] Enter email manually   [Q] Quit"

OUTPUT: "✓ Webhook received"
        "  Email  : [test_email]"
        "  Plan   : [response[0].plan]"
        "  Status : [response[0].status]"
        "  Expires: [response[0].current_period_end]"
```

### STEP 5B.4 — Verify is_premium() via anon key

```
POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/is_premium
     apikey: {PAYCRAFT_SUPABASE_ANON_KEY}
     Body: {"user_email": "[test_email]"}

VERIFY: HTTP 200 AND body = true
IF false: HARD STOP — "is_premium() returned false despite active row. Check RPC SQL."
OUTPUT: "✓ is_premium() = true for [test_email]"
```

### STEP 5B.5 — Verify get_subscription() returns friendly plan name

```
POST {PAYCRAFT_SUPABASE_URL}/rest/v1/rpc/get_subscription
     apikey: {PAYCRAFT_SUPABASE_ANON_KEY}
     Body: {"user_email": "[test_email]"}

VERIFY: HTTP 200 AND response[0].status = "active"
CHECK: plan field = one of [monthly/quarterly/semiannual/yearly]
IF plan starts with "price_":
  DISPLAY: "⚠️ Plan stored as Stripe price_id — not the friendly name."
           "Fix: Verify payment link has metadata[plan_id] set in Stripe Dashboard."
           "Fix: Verify stripe-webhook/index.ts reads session.metadata?.plan_id first."
OUTPUT: "✓ get_subscription() → plan=[plan] status=active"
```

### STEP 5B.6 — Manual app verification

```
DISPLAY:
"╔══ Verify Premium State in App ═══════════════════════════════════╗"
"║                                                                    ║"
"║  On your device/emulator:                                         ║"
"║  1. Open the app                                                  ║"
"║  2. Navigate to Settings tab                                      ║"
"║  3. If prompted for email → enter: [test_email]                   ║"
"║  4. Scroll to the PayCraft banner section                         ║"
"║                                                                    ║"
"║  Expected:                                                        ║"
"║  ✓ PayCraftBanner shows PREMIUM / Manage state                   ║"
"║  ✓ Plan: [plan name] (not a price_xxx ID)                        ║"
"║  ✓ 'Manage Subscription' button visible                          ║"
"║                                                                    ║"
"║  If still showing 'Upgrade':                                      ║"
"║  → Background the app + bring it back (triggers ON_RESUME)       ║"
"║  → Or pull-to-refresh if available                               ║"
"║                                                                    ║"
"║  [✓] Premium showing correctly                                    ║"
"║  [✗] Still showing Upgrade → run diagnosis                       ║"
"║  [S] Skip (API verified, no device available)                     ║"
"╚════════════════════════════════════════════════════════════════════╝"
```

IF [✗]: run STEP 5B.6B (KMP diagnosis checklist)
IF [✓] or [S]: proceed to 5B.7

### STEP 5B.6B — Diagnose premium state not showing in app

```
CHECK 1: Does SettingsScreen.kt (commonMain) contain LifecycleEventEffect(Lifecycle.Event.ON_RESUME)?
  Grep: LifecycleEventEffect in feature/settings/src/commonMain/**/*.kt
  IF missing: "Add LifecycleEventEffect(ON_RESUME) { payCraftBillingManager.refreshStatus() } to SettingsScreen"

CHECK 2: Is BillingManager injected in SettingsScreen.kt (not in MainActivity)?
  Grep: BillingManager OR payCraftBillingManager in SettingsScreen.kt
  IF missing: "Add payCraftBillingManager: BillingManager = koinInject() parameter to SettingsScreen"

CHECK 3: Is PayCraftModule in Koin?
  Grep: PayCraftModule in KoinModules.kt
  IF missing: "Add PayCraftModule to the includes(...) list in KoinModules"

CHECK 4: Is BillingManager.logIn(email) called with the user's email?
  Grep: billingManager.logIn OR payCraftBillingManager.logIn in commonMain
  IF missing: "Call payCraftBillingManager.logIn(email) when user sets email (e.g. in Restore flow)"

DISPLAY all findings. User fixes, then re-checks.
```

### STEP 5B.7 — Write sandbox test result

```
WRITE: {target_app_path}/.paycraft/sandbox_test.json
{
  "tested_at": "[ISO8601 UTC]",
  "email_used": "[test_email]",
  "plan_tested": "[plan]",
  "webhook_received": true,
  "is_premium_api": true,
  "plan_id_correct": [true/false],
  "app_premium_state": "[confirmed/skipped]",
  "result": "PASS"
}

OUTPUT:
"╔══ PHASE 5B COMPLETE — Sandbox Test ════════════════════════════╗"
"║                                                                  ║"
"║  ✓ Test payment completed (card: 4242...)                       ║"
"║  ✓ Stripe webhook fired → subscription row in DB               ║"
"║  ✓ is_premium() = true via anon key                            ║"
"║  ✓ get_subscription() → plan=[plan] status=active              ║"
"║  ✓ App premium state: [confirmed/skipped]                      ║"
"║                                                                  ║"
"║  Ready to go live? → [C] Test live (Phase 5C)                  ║"
"║  Need live keys?   → [D] Get keys guide (Phase 6)              ║"
"╚══════════════════════════════════════════════════════════════════╝"
```

---

## PHASE 5C — Live E2E Test (real card, real money)

> Option [C] in the menu. Tests complete flow with a real payment card.
> A real charge is made. Verify then refund immediately via Stripe Dashboard.
> Run this ONLY after Phase 5B (sandbox) passes.

### Prerequisites

```
VERIFY Phase 5B result: Read .paycraft/sandbox_test.json → result = "PASS"
IF missing or result != "PASS":
  HARD STOP: "Complete Phase 5B (sandbox test) before running live test."

Read .env → MUST be ✓:
  - PAYCRAFT_STRIPE_LIVE_SECRET_KEY starts with "sk_live_"
  - PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY (or equivalent) set
  - PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET starts with "whsec_"
  - PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY set

IF any missing:
  DISPLAY:
    "Missing live keys. Run Phase 6 (Get keys guide) to obtain them."
    "Then run Phase 3B to create live Stripe products + payment links."
  → STOP
```

### STEP 5C.1 — Confirm live mode is enabled in app

```
CHECK: PayCraftConfig.kt → IS_TEST_MODE = false?
IF IS_TEST_MODE = true:
  DISPLAY:
    "⚠️ App is still in TEST mode (IS_TEST_MODE = true in PayCraftConfig.kt)."
    "For live test, set IS_TEST_MODE = false and rebuild the app."
    "[C] I've set IS_TEST_MODE = false and rebuilt   [S] Skip — test API only (no app)"
  IF [S]: skip app verification steps, test API only
```

### STEP 5C.2 — Confirm live Supabase secrets are updated

```
CHECK Supabase function secrets:
  ACTION: supabase secrets list --project-ref [ref]
  VERIFY: STRIPE_SECRET_KEY digest has changed (compare with test key digest)

IF not updated:
  DISPLAY:
    "Update Supabase function secrets for live mode:"
    "  supabase secrets set STRIPE_SECRET_KEY=[PAYCRAFT_STRIPE_LIVE_SECRET_KEY]"
    "                       STRIPE_WEBHOOK_SECRET=[PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET]"
    "                       --project-ref [ref]"
    "[C] Done   [Q] Quit"
  WAIT: [C]
```

### STEP 5C.3 — Display live payment instructions

```
DISPLAY:
"╔══ Live Payment Test ════════════════════════════════════════════╗"
"║                                                                   ║"
"║  ⚠️  This will charge a real card. Refund immediately after.     ║"
"║                                                                   ║"
"║  Live payment links:                                             ║"
"║  Monthly    : [PAYCRAFT_STRIPE_LIVE_LINK_MONTHLY]               ║"
"║  (Use monthly — smallest amount, easiest to refund)             ║"
"║                                                                   ║"
"║  Use a real card you can refund (your own card recommended).    ║"
"║  After payment, refund at:                                       ║"
"║  https://dashboard.stripe.com/payments → find payment → Refund  ║"
"║                                                                   ║"
"║  [C] Open payment link + complete payment, then return here     ║"
"║  [S] Skip live test (keep test mode)                            ║"
"╚═════════════════════════════════════════════════════════════════╝"

IF [S]: mark live test as skipped, stop
IF [C]: ASK "What email did you use?" → store live_email
```

### STEP 5C.4 — Poll DB + verify (same as 5B.3–5B.5 but with live keys)

```
POLL: GET subscriptions?email=eq.[live_email]
      apikey: PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY

Run same checks as 5B.3, 5B.4, 5B.5 using live_email.

IF webhook not received in 30s:
  DISPLAY:
    "Troubleshoot live webhook:"
    "  1. Stripe Dashboard (LIVE mode) → Developers → Webhooks → Recent Deliveries"
    "  2. Confirm endpoint URL: {PAYCRAFT_SUPABASE_URL}/functions/v1/stripe-webhook"
    "  3. Confirm STRIPE_WEBHOOK_SECRET in Supabase matches the LIVE webhook signing secret"
    "     (Live and test webhooks have DIFFERENT signing secrets — easy to mix up)"
    "  4. Check function logs: supabase functions logs stripe-webhook --project-ref [ref]"
```

### STEP 5C.5 — Prompt to refund + verify app

```
DISPLAY:
"╔══ Refund the test charge ═══════════════════════════════════════╗"
"║                                                                   ║"
"║  Verify the app shows premium state first, then refund:         ║"
"║  1. Open app → Settings → verify PayCraftBanner shows premium   ║"
"║  2. Refund the charge:                                           ║"
"║     https://dashboard.stripe.com/payments                       ║"
"║     → Find the payment → Actions → Refund                       ║"
"║  3. Confirm the subscription was cancelled in Stripe            ║"
"║                                                                   ║"
"║  [✓] App shows premium + refund issued                          ║"
"║  [S] Skip refund (intentional — I'm keeping the subscription)   ║"
"╚═════════════════════════════════════════════════════════════════╝"
```

### STEP 5C.6 — Write live test result

```
WRITE: {target_app_path}/.paycraft/live_test.json
{
  "tested_at": "[ISO8601 UTC]",
  "email_used": "[live_email]",
  "plan_tested": "monthly",
  "webhook_received": true,
  "is_premium_api": true,
  "app_premium_state": "[confirmed/skipped]",
  "refund_issued": [true/false],
  "result": "PASS"
}

OUTPUT:
"╔══ PHASE 5C COMPLETE — Live Test ═══════════════════════════════╗"
"║                                                                  ║"
"║  ✓ Live payment processed                                      ║"
"║  ✓ Webhook fired → subscription row in DB                      ║"
"║  ✓ is_premium() = true (live mode)                             ║"
"║  ✓ App shows premium state                                     ║"
"║  ✓ Refund issued: [yes/no]                                     ║"
"║                                                                  ║"
"║  STATUS: FULLY OPERATIONAL — LIVE MODE ✓                       ║"
"╚══════════════════════════════════════════════════════════════════╝"
```

---

## PHASE 6 — Real Keys Guide (How to Get Every Key)

> Option [D] in the menu. No automation — human steps in external dashboards.
> Displays the complete guide for obtaining every key needed for test AND live mode.

```
╔══ Getting Real Keys — Complete Guide ═══════════════════════════════════════════╗
║  Complete ALL sections before switching IS_TEST_MODE = false in PayCraftConfig  ║
╚═════════════════════════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION A — SUPABASE KEYS  (same project for test AND live)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Supabase uses ONE project for both test and live Stripe. Keys do not change when going live.

A1. PAYCRAFT_SUPABASE_URL                     Status: [from matrix]
    1. https://supabase.com/dashboard → select project
    2. Settings (sidebar) → API
    3. Copy "Project URL"  (e.g. https://xxxxx.supabase.co)

A2. PAYCRAFT_SUPABASE_ANON_KEY                Status: [from matrix]
    1. Same page: Settings → API
    2. Under "Project API keys" → copy "anon" key
    3. Safe for client-side use (enforced by RLS)

A3. PAYCRAFT_SUPABASE_SERVICE_ROLE_KEY        Status: [from matrix]
    1. Same page: Settings → API
    2. Copy "service_role" key  ⚠️ NEVER put in client code — server/Edge Functions only

A4. PAYCRAFT_SUPABASE_PROJECT_REF             Status: [from matrix]
    1. From the project URL: https://supabase.com/dashboard/project/[THIS_IS_THE_REF]
    2. Or: Settings → General → "Reference ID"
    (20-character alphanumeric string)

A5. PAYCRAFT_SUPABASE_ACCESS_TOKEN            Status: [from matrix]
    1. https://supabase.com/dashboard/account/tokens
    2. "Generate new token" → name it "PayCraft CLI"
    3. Copy the sbp_... token (shown ONCE — save it)
    Used for: supabase CLI commands (deploy functions, set secrets)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION B — STRIPE TEST KEYS  (sandbox, no real money)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prerequisite: Stripe account registered at https://dashboard.stripe.com/register

B1. PAYCRAFT_STRIPE_TEST_SECRET_KEY           Status: [from matrix]
    1. https://dashboard.stripe.com
    2. Toggle "Test mode" ON (top-right switch, looks like a slider)
    3. Developers (sidebar) → API keys
    4. "Secret key" row → click "Reveal test key"
    5. Copy sk_test_... value
    ⚠️ Never commit to git. Store in .env only.

B2. PAYCRAFT_STRIPE_WEBHOOK_SECRET            Status: [from matrix]
    1. Stripe Dashboard (Test mode) → Developers → Webhooks
    2. Find your endpoint (URL: {PAYCRAFT_SUPABASE_URL}/functions/v1/stripe-webhook)
       If no endpoint: Phase 2 + Phase 3A create it automatically
    3. Click the endpoint → "Signing secret" → click "Reveal"
    4. Copy whsec_... value
    Note: This secret matches what's set in Supabase function secrets as STRIPE_WEBHOOK_SECRET

B3. PAYCRAFT_STRIPE_LINK_* (test payment links)   Status: [from matrix]
    These are created AUTOMATICALLY by Phase 3A (run /paycraft-adopt → [A] Full setup → Phase 3 test mode).
    To create manually:
    1. Stripe Dashboard (Test mode) → Payment Links → "New"
    2. Select product + price (created by Phase 3A)
    3. Advanced → Metadata → Add: key=plan_id, value=monthly (or quarterly/semiannual/yearly)
    4. Confirmation page → Redirect → enter: [PAYCRAFT_APP_REDIRECT_URL]
    5. Create → copy https://buy.stripe.com/test_... URL

B4. PAYCRAFT_STRIPE_PORTAL_URL (test)             Status: [from matrix]
    1. Stripe Dashboard (Test mode) → Billing → Customer portal (sidebar)
    2. Configure: enable "Cancel subscription", "Update payment method", "View invoices"
    3. Click "Save changes"
    4. The portal URL appears below: https://billing.stripe.com/p/login/test_...
       OR click "Copy link" button

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION C — STRIPE LIVE KEYS  (real money — do this last)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Prerequisite: Stripe account MUST be activated with identity verification.
  1. https://dashboard.stripe.com/account/onboarding
  2. Complete business details, bank account, identity verification
  3. Wait for approval (usually instant for individuals)

C1. PAYCRAFT_STRIPE_LIVE_SECRET_KEY               Status: [from matrix]
    1. Stripe Dashboard → Toggle "Live mode" ON (test mode switch turns OFF)
    2. Developers → API keys
    3. "Secret key" → "Reveal live key"
    4. Copy sk_live_... value
    ⚠️ This key charges real money. Never commit. Rotate immediately if leaked.

C2. PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET           Status: [from matrix]
    Phase 3B creates the live webhook endpoint automatically.
    To get the secret after Phase 3B runs:
    1. Stripe Dashboard (LIVE mode) → Developers → Webhooks
    2. Find: {PAYCRAFT_SUPABASE_URL}/functions/v1/stripe-webhook
    3. Click endpoint → "Signing secret" → "Reveal" → copy whsec_...
    ⚠️ Different from test webhook secret — each endpoint has its own secret.
    After getting it: run supabase secrets set STRIPE_WEBHOOK_SECRET=[live_secret]
                                               STRIPE_SECRET_KEY=[sk_live_...]
                          --project-ref [ref]

C3. PAYCRAFT_STRIPE_LIVE_LINK_* (live payment links)
    Created automatically by Phase 3B (run /paycraft-adopt → [F] Fix specific phase → Phase 3 with PAYCRAFT_MODE=live).
    Each link will be https://buy.stripe.com/... (no /test/ prefix in live mode).
    These go in PayCraftConfig.kt → LIVE_PAYMENT_LINKS map.

C4. PAYCRAFT_STRIPE_LIVE_PORTAL_URL               Status: [from matrix]
    1. Stripe Dashboard (LIVE mode) → Billing → Customer portal
    2. Same configuration as test portal
    3. Copy live portal URL: https://billing.stripe.com/p/login/...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION D — APP DEEP LINK (redirect after payment)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

D1. PAYCRAFT_APP_REDIRECT_URL                     Status: [from matrix]
    Format: [your-app-scheme]://paycraft/premium/success
    Example: reelsdownloader://paycraft/premium/success

    To define your scheme:
    1. Choose a unique scheme (e.g. your app package name reversed: com.yourapp → yourapp)
    2. Set in .env: PAYCRAFT_APP_REDIRECT_URL=yourapp://paycraft/premium/success
    3. Phase 4 (Step 4.7B) registers it in AndroidManifest.xml automatically:
       <data android:scheme="yourapp" android:host="paycraft" android:pathPrefix="/premium" />
    4. For iOS: Phase 4 adds CFBundleURLTypes to Info.plist
    Note: The same URL is used for both test and live payment links.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION E — GOING LIVE CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Complete ALL of these before flipping IS_TEST_MODE = false:

[ ] Phase 5B PASSED  (sandbox test card → webhook → is_premium = true)
[ ] Stripe account ACTIVATED  (identity verified, bank connected)
[ ] PAYCRAFT_STRIPE_LIVE_SECRET_KEY set (sk_live_...)
[ ] Phase 3B completed (live products + payment links + live webhook endpoint)
[ ] PAYCRAFT_STRIPE_LIVE_LINK_* all set in .env
[ ] PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET set in .env
[ ] Supabase secrets updated for live:
      supabase secrets set STRIPE_SECRET_KEY=[sk_live_...]
                           STRIPE_WEBHOOK_SECRET=[live_whsec_...]
          --project-ref [ref]
[ ] PayCraftConfig.kt LIVE_PAYMENT_LINKS filled
[ ] IS_TEST_MODE = false in PayCraftConfig.kt
[ ] App rebuilt with IS_TEST_MODE = false
[ ] Phase 5C (live test) PASSED

⚠️  KEY SEPARATION REMINDER:
  - Stripe test mode and live mode have SEPARATE webhook endpoints and signing secrets
  - Register the webhook URL at:
    Test:  https://dashboard.stripe.com/test/webhooks
    Live:  https://dashboard.stripe.com/webhooks
  - The Supabase function URL is the SAME for both — only the secrets differ
  - Always update STRIPE_WEBHOOK_SECRET in Supabase secrets when switching modes
```

After displaying, show:
```
"[A] Run test setup now (Phase 1–3A)"
"[B] Run live setup now (Phase 3B — requires live keys above)"
"[C] Re-run status matrix"
"[Q] Done"
```

---

## Enforcement Rules (STRICTLY ENFORCED)

1. **STRICT SEQUENCE**: Phase 1→2→3→4→5→5B→5C. Phase 5C requires 5B to PASS first.
2. **VERIFY AFTER EVERY ACTION**: Every API call, migration, deploy = immediate verify. Fail = HARD STOP.
3. **KMP-FIRST**: Zero platform-specific billing code. All PayCraft calls in `commonMain`.
   `LifecycleEventEffect(ON_RESUME)` in SettingsScreen (commonMain) only.
   `BillingManager` injected via `koinInject()` in Composable — never in Activity.
4. **USER ACTION GATES**: Browser steps → numbered checklist + exact URL → PAUSE → verify.
5. **TEST BEFORE LIVE**: Phase 5B (sandbox) MUST PASS before Phase 3B (live) or Phase 5C.
6. **HARD STOP FORMAT**:
   ```
   ✗ HARD STOP — [step] failed
   Reason: [exact error]
   Fix   : [numbered steps]
   Run this step again after fixing.
   ```
7. **PHASE CHECKPOINTS**: Summary at end of every phase. User confirms before next.

---

## Phase Runtime Files (internal — not user-facing)

These files are loaded internally by this runtime. They are NOT commands exposed to users.

| File | Phase |
|------|-------|
| `layers/paycraft/commands/paycraft-adopt-env.md` | Phase 1 — ENV bootstrap + key validation |
| `layers/paycraft/commands/paycraft-adopt-supabase.md` | Phase 2 — Supabase migrations + webhook |
| `layers/paycraft/commands/paycraft-adopt-stripe.md` | Phase 3 — Stripe products + payment links |
| `layers/paycraft/commands/paycraft-adopt-razorpay.md` | Phase 3B — Razorpay payment links |
| `layers/paycraft/commands/paycraft-adopt-client.md` | Phase 4 — KMP client integration |
| `layers/paycraft/commands/paycraft-adopt-verify.md` | Phase 5 — E2E verification |

To re-run a specific phase: run `/paycraft-adopt` → choose **[F] Fix specific phase** from the action menu.
